-- Automatic Stripe credit grant and duplication safeguards

ALTER TABLE public.plan_orders
ADD COLUMN IF NOT EXISTS credits_granted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS credit_grant_source TEXT,
ADD COLUMN IF NOT EXISTS stripe_checkout_expires_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS duplicate_payment_detected BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS duplicate_payment_count INT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS requires_refund_review BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS refund_review_reason TEXT;

ALTER TABLE public.plan_orders
DROP CONSTRAINT IF EXISTS plan_orders_credit_grant_source_check;

ALTER TABLE public.plan_orders
ADD CONSTRAINT plan_orders_credit_grant_source_check
CHECK (
  credit_grant_source IS NULL
  OR credit_grant_source IN ('admin_manual', 'stripe_webhook')
);

CREATE TABLE IF NOT EXISTS public.stripe_payment_anomalies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.plan_orders(id) ON DELETE CASCADE,
  stripe_event_id TEXT,
  stripe_payment_intent_id TEXT,
  stripe_checkout_session_id TEXT,
  anomaly_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.stripe_payment_anomalies
DROP CONSTRAINT IF EXISTS stripe_payment_anomalies_anomaly_type_check;

ALTER TABLE public.stripe_payment_anomalies
ADD CONSTRAINT stripe_payment_anomalies_anomaly_type_check
CHECK (anomaly_type IN ('duplicate_payment', 'unexpected_state', 'amount_mismatch'));

ALTER TABLE public.stripe_payment_anomalies
DROP CONSTRAINT IF EXISTS stripe_payment_anomalies_status_check;

ALTER TABLE public.stripe_payment_anomalies
ADD CONSTRAINT stripe_payment_anomalies_status_check
CHECK (status IN ('open', 'investigating', 'resolved', 'refunded'));

CREATE INDEX IF NOT EXISTS idx_stripe_payment_anomalies_order_created
ON public.stripe_payment_anomalies(order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stripe_payment_anomalies_status
ON public.stripe_payment_anomalies(status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stripe_payment_anomalies_duplicate_unique
ON public.stripe_payment_anomalies(order_id, anomaly_type, stripe_payment_intent_id)
WHERE anomaly_type = 'duplicate_payment' AND stripe_payment_intent_id IS NOT NULL;

ALTER TABLE public.stripe_payment_anomalies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view stripe payment anomalies" ON public.stripe_payment_anomalies;
CREATE POLICY "Admins can view stripe payment anomalies"
  ON public.stripe_payment_anomalies FOR SELECT
  USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Service role can manage stripe payment anomalies" ON public.stripe_payment_anomalies;
CREATE POLICY "Service role can manage stripe payment anomalies"
  ON public.stripe_payment_anomalies FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP TRIGGER IF EXISTS update_stripe_payment_anomalies_updated_at ON public.stripe_payment_anomalies;
CREATE TRIGGER update_stripe_payment_anomalies_updated_at
  BEFORE UPDATE ON public.stripe_payment_anomalies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.log_stripe_payment_anomaly(
  p_order_id UUID,
  p_anomaly_type TEXT,
  p_stripe_event_id TEXT DEFAULT NULL,
  p_stripe_payment_intent_id TEXT DEFAULT NULL,
  p_stripe_checkout_session_id TEXT DEFAULT NULL,
  p_details JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  BEGIN
    INSERT INTO public.stripe_payment_anomalies (
      order_id,
      stripe_event_id,
      stripe_payment_intent_id,
      stripe_checkout_session_id,
      anomaly_type,
      details
    )
    VALUES (
      p_order_id,
      p_stripe_event_id,
      p_stripe_payment_intent_id,
      p_stripe_checkout_session_id,
      p_anomaly_type,
      COALESCE(p_details, '{}'::jsonb)
    )
    RETURNING id INTO v_id;
  EXCEPTION
    WHEN unique_violation THEN
      UPDATE public.stripe_payment_anomalies spa
      SET
        details = COALESCE(p_details, spa.details),
        updated_at = now(),
        stripe_event_id = COALESCE(p_stripe_event_id, spa.stripe_event_id),
        stripe_checkout_session_id = COALESCE(p_stripe_checkout_session_id, spa.stripe_checkout_session_id)
      WHERE spa.order_id = p_order_id
        AND spa.anomaly_type = p_anomaly_type
        AND spa.stripe_payment_intent_id IS NOT DISTINCT FROM p_stripe_payment_intent_id
      RETURNING spa.id INTO v_id;
  END;

  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, message)
  SELECT
    p.id,
    'plan_order_payment_duplicate',
    'Duplicidade de pagamento detectada',
    format('Pedido %s teve possível duplicidade de pagamento e requer revisão de estorno.', p_order_id)
  FROM public.profiles p
  WHERE p.role = 'admin';

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_stripe_paid_order(
  p_order_id UUID,
  p_stripe_event_id TEXT,
  p_checkout_session_id TEXT DEFAULT NULL,
  p_payment_intent_id TEXT DEFAULT NULL,
  p_customer_id TEXT DEFAULT NULL,
  p_amount_total_cents INT DEFAULT NULL,
  p_currency TEXT DEFAULT 'brl',
  p_payment_method_type TEXT DEFAULT NULL,
  p_paid_at TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.plan_orders%ROWTYPE;
  v_latest public.student_plan_selections%ROWTYPE;
  v_validity_days INT;
  v_candidate_expires_at TIMESTAMPTZ;
  v_new_expires_at TIMESTAMPTZ;
  v_new_remaining INT;
  v_selection_id UUID;
  v_paid_at TIMESTAMPTZ;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'Pedido inválido';
  END IF;

  v_paid_at := COALESCE(p_paid_at, now());

  SELECT *
  INTO v_order
  FROM public.plan_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'Pedido não encontrado';
  END IF;

  IF v_order.credited_selection_id IS NOT NULL OR v_order.credits_granted_at IS NOT NULL OR v_order.status = 'approved' THEN
    IF p_payment_intent_id IS NOT NULL
       AND v_order.stripe_payment_intent_id IS NOT NULL
       AND v_order.stripe_payment_intent_id <> p_payment_intent_id THEN
      UPDATE public.plan_orders
      SET
        duplicate_payment_detected = true,
        duplicate_payment_count = duplicate_payment_count + 1,
        requires_refund_review = true,
        refund_review_reason = 'Pagamento duplicado detectado por novo payment_intent em pedido já creditado.',
        payment_updated_at = now(),
        stripe_latest_event_id = COALESCE(p_stripe_event_id, stripe_latest_event_id)
      WHERE id = v_order.id;

      PERFORM public.log_stripe_payment_anomaly(
        p_order_id => v_order.id,
        p_anomaly_type => 'duplicate_payment',
        p_stripe_event_id => p_stripe_event_id,
        p_stripe_payment_intent_id => p_payment_intent_id,
        p_stripe_checkout_session_id => p_checkout_session_id,
        p_details => jsonb_build_object(
          'reason', 'different_payment_intent_on_already_credited_order',
          'existing_payment_intent', v_order.stripe_payment_intent_id,
          'incoming_payment_intent', p_payment_intent_id,
          'status', v_order.status
        )
      );

      RETURN jsonb_build_object('result', 'duplicate_detected', 'order_id', v_order.id, 'credited', true);
    END IF;

    UPDATE public.plan_orders
    SET
      payment_provider = 'stripe',
      payment_method = 'stripe_checkout',
      stripe_checkout_session_id = COALESCE(p_checkout_session_id, stripe_checkout_session_id),
      stripe_payment_intent_id = COALESCE(p_payment_intent_id, stripe_payment_intent_id),
      stripe_customer_id = COALESCE(p_customer_id, stripe_customer_id),
      stripe_payment_status = 'paid',
      paid_at = COALESCE(paid_at, v_paid_at),
      payment_confirmed_at = COALESCE(payment_confirmed_at, v_paid_at),
      payment_method_type = COALESCE(p_payment_method_type, payment_method_type),
      currency = COALESCE(NULLIF(BTRIM(COALESCE(p_currency, '')), ''), currency, 'brl'),
      amount_total_cents = COALESCE(p_amount_total_cents, amount_total_cents, price_amount_cents),
      payment_updated_at = now(),
      stripe_latest_event_id = COALESCE(p_stripe_event_id, stripe_latest_event_id)
    WHERE id = v_order.id;

    RETURN jsonb_build_object('result', 'already_credited', 'order_id', v_order.id, 'credited', true);
  END IF;

  IF v_order.status = 'cancelled' THEN
    PERFORM public.log_stripe_payment_anomaly(
      p_order_id => v_order.id,
      p_anomaly_type => 'unexpected_state',
      p_stripe_event_id => p_stripe_event_id,
      p_stripe_payment_intent_id => p_payment_intent_id,
      p_stripe_checkout_session_id => p_checkout_session_id,
      p_details => jsonb_build_object(
        'reason', 'payment_confirmed_for_cancelled_order',
        'status', v_order.status
      )
    );

    RETURN jsonb_build_object('result', 'cancelled_order_anomaly', 'order_id', v_order.id, 'credited', false);
  END IF;

  v_validity_days := COALESCE(NULLIF(v_order.validity_days, 0), public.get_plan_validity_days(v_order.credits_amount));
  v_candidate_expires_at := now() + make_interval(days => v_validity_days);

  SELECT sps.*
  INTO v_latest
  FROM public.student_plan_selections sps
  WHERE sps.student_id = v_order.user_id
    AND sps.status = 'active'
    AND sps.class_type = v_order.class_type
  ORDER BY sps.selected_at DESC, sps.updated_at DESC, sps.id DESC
  LIMIT 1
  FOR UPDATE OF sps;

  IF v_latest IS NULL OR v_latest.expires_at <= now() THEN
    v_new_remaining := v_order.credits_amount;
    v_new_expires_at := v_candidate_expires_at;
  ELSE
    v_new_remaining := GREATEST(COALESCE(v_latest.remaining_credits, 0), 0) + v_order.credits_amount;
    v_new_expires_at := GREATEST(v_latest.expires_at, v_candidate_expires_at);
  END IF;

  INSERT INTO public.student_plan_selections (
    student_id,
    plan_id,
    month_ref,
    credits,
    remaining_credits,
    price_cents,
    status,
    selected_at,
    expires_at,
    updated_at,
    class_type
  )
  VALUES (
    v_order.user_id,
    v_order.plan_id,
    public.get_month_ref(now()),
    v_order.credits_amount,
    v_new_remaining,
    v_order.price_amount_cents,
    'active',
    now(),
    v_new_expires_at,
    now(),
    v_order.class_type
  )
  RETURNING id INTO v_selection_id;

  UPDATE public.plan_orders
  SET
    status = 'approved',
    approved_at = now(),
    approved_by = NULL,
    payment_provider = 'stripe',
    payment_method = 'stripe_checkout',
    stripe_checkout_session_id = COALESCE(p_checkout_session_id, stripe_checkout_session_id),
    stripe_payment_intent_id = COALESCE(p_payment_intent_id, stripe_payment_intent_id),
    stripe_customer_id = COALESCE(p_customer_id, stripe_customer_id),
    stripe_payment_status = 'paid',
    paid_at = COALESCE(paid_at, v_paid_at),
    payment_confirmed_at = COALESCE(payment_confirmed_at, v_paid_at),
    payment_method_type = COALESCE(p_payment_method_type, payment_method_type),
    amount_total_cents = COALESCE(p_amount_total_cents, amount_total_cents, price_amount_cents),
    currency = COALESCE(NULLIF(BTRIM(COALESCE(p_currency, '')), ''), currency, 'brl'),
    credited_selection_id = v_selection_id,
    credits_granted_at = now(),
    credit_grant_source = 'stripe_webhook',
    payment_updated_at = now(),
    stripe_latest_event_id = COALESCE(p_stripe_event_id, stripe_latest_event_id),
    admin_notes = COALESCE(NULLIF(BTRIM(admin_notes), ''), 'Pagamento Stripe confirmado e créditos liberados automaticamente.')
  WHERE id = v_order.id;

  PERFORM public.sync_student_month_credit_snapshot(v_order.user_id);

  INSERT INTO public.notifications (user_id, type, title, message)
  VALUES (
    v_order.user_id,
    'credit_purchase_approved',
    'Créditos liberados automaticamente',
    format('Seu pagamento do pedido "%s" foi confirmado e %s créditos já estão disponíveis.', v_order.plan_name, v_order.credits_amount)
  );

  INSERT INTO public.notifications (user_id, type, title, message)
  SELECT
    p.id,
    'plan_order_paid_auto',
    'Pagamento confirmado automaticamente',
    format('Pedido %s foi pago via Stripe e creditado automaticamente.', v_order.id)
  FROM public.profiles p
  WHERE p.role = 'admin';

  RETURN jsonb_build_object(
    'result', 'credited',
    'order_id', v_order.id,
    'selection_id', v_selection_id,
    'credited', true
  );
END;
$$;
