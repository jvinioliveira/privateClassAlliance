-- Harden manual payment flow for plan orders:
-- 1) payment deadline applies only before student confirms payment
-- 2) expired pending payments are cancelled automatically
-- 3) approval transitions are enforced server-side
-- 4) plan_orders status changes happen through RPCs, not direct table updates

CREATE OR REPLACE FUNCTION public.plan_order_payment_deadline_at(p_created_at TIMESTAMPTZ)
RETURNS TIMESTAMPTZ
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_created_at + INTERVAL '30 minutes'
$$;

CREATE OR REPLACE FUNCTION public.expire_stale_plan_orders(p_user_id UUID DEFAULT auth.uid())
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_is_admin BOOLEAN;
  v_rows INT;
BEGIN
  v_actor := auth.uid();

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;

  v_is_admin := public.is_admin(v_actor);

  IF p_user_id IS NULL AND NOT v_is_admin THEN
    p_user_id := v_actor;
  END IF;

  IF p_user_id IS NOT NULL AND p_user_id <> v_actor AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  UPDATE public.plan_orders po
  SET
    status = 'cancelled',
    admin_notes = COALESCE(
      NULLIF(BTRIM(po.admin_notes), ''),
      'Pedido cancelado automaticamente por expiração do prazo de pagamento.'
    ),
    updated_at = now()
  WHERE po.plan_type = 'fixed'
    AND po.status = 'pending_payment'
    AND po.created_at <= now() - INTERVAL '30 minutes'
    AND (p_user_id IS NULL OR po.user_id = p_user_id);

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN COALESCE(v_rows, 0);
END;
$$;

CREATE INDEX IF NOT EXISTS idx_plan_orders_pending_payment_created
ON public.plan_orders (created_at)
WHERE plan_type = 'fixed' AND status = 'pending_payment';

CREATE INDEX IF NOT EXISTS idx_plan_orders_user_plan_pending
ON public.plan_orders (user_id, plan_id, created_at DESC)
WHERE plan_type = 'fixed' AND status = 'pending_payment';

DROP POLICY IF EXISTS "Admins can manage all plan orders" ON public.plan_orders;
DROP POLICY IF EXISTS "Admins can view all plan orders" ON public.plan_orders;
CREATE POLICY "Admins can view all plan orders"
  ON public.plan_orders FOR SELECT
  USING (public.is_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.create_fixed_plan_order(p_plan_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.lesson_plans%ROWTYPE;
  v_order_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;

  PERFORM public.expire_stale_plan_orders(auth.uid());

  SELECT *
  INTO v_plan
  FROM public.lesson_plans
  WHERE id = p_plan_id
    AND is_active = true;

  IF v_plan IS NULL THEN
    RAISE EXCEPTION 'Plano não encontrado ou inativo';
  END IF;

  SELECT po.id
  INTO v_order_id
  FROM public.plan_orders po
  WHERE po.user_id = auth.uid()
    AND po.plan_type = 'fixed'
    AND po.status = 'pending_payment'
    AND po.plan_id = v_plan.id
  ORDER BY po.created_at DESC
  LIMIT 1;

  IF v_order_id IS NOT NULL THEN
    RETURN v_order_id;
  END IF;

  INSERT INTO public.plan_orders (
    user_id,
    plan_id,
    plan_name,
    plan_type,
    class_type,
    credits_amount,
    validity_days,
    price_amount_cents,
    status,
    pix_code,
    pix_qr_image_url,
    credit_payment_url
  )
  VALUES (
    auth.uid(),
    v_plan.id,
    v_plan.name,
    'fixed',
    v_plan.class_type,
    v_plan.credits,
    public.get_plan_validity_days(v_plan.credits),
    v_plan.price_cents,
    'pending_payment',
    v_plan.pix_code,
    v_plan.pix_qr_image_url,
    v_plan.credit_payment_url
  )
  RETURNING id INTO v_order_id;

  RETURN v_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_plan_order_payment(
  p_order_id UUID,
  p_payment_method TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.plan_orders%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;

  IF p_payment_method NOT IN ('pix', 'credit_link') THEN
    RAISE EXCEPTION 'Método de pagamento inválido';
  END IF;

  PERFORM public.expire_stale_plan_orders(auth.uid());

  SELECT *
  INTO v_order
  FROM public.plan_orders
  WHERE id = p_order_id
    AND user_id = auth.uid()
  FOR UPDATE;

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'Pedido não encontrado';
  END IF;

  IF v_order.plan_type <> 'fixed' THEN
    RAISE EXCEPTION 'Este pedido não utiliza etapa de pagamento padrão';
  END IF;

  IF v_order.status = 'cancelled' THEN
    RAISE EXCEPTION 'Este pedido foi cancelado';
  END IF;

  IF v_order.status = 'approved' THEN
    RAISE EXCEPTION 'Este pedido já foi aprovado';
  END IF;

  IF v_order.status = 'awaiting_approval' THEN
    RAISE EXCEPTION 'Pagamento já informado. Aguarde a aprovação do professor';
  END IF;

  IF v_order.status <> 'pending_payment' THEN
    RAISE EXCEPTION 'Status inválido para confirmação de pagamento';
  END IF;

  IF now() > public.plan_order_payment_deadline_at(v_order.created_at) THEN
    UPDATE public.plan_orders
    SET
      status = 'cancelled',
      admin_notes = COALESCE(
        NULLIF(BTRIM(admin_notes), ''),
        'Pedido cancelado automaticamente por expiração do prazo de pagamento.'
      ),
      updated_at = now()
    WHERE id = v_order.id;

    RAISE EXCEPTION 'Prazo de pagamento expirado. Crie um novo pedido para continuar';
  END IF;

  IF p_payment_method = 'pix'
     AND NULLIF(BTRIM(COALESCE(v_order.pix_code, '')), '') IS NULL
     AND NULLIF(BTRIM(COALESCE(v_order.pix_qr_image_url, '')), '') IS NULL THEN
    RAISE EXCEPTION 'PIX ainda não configurado para este plano';
  END IF;

  IF p_payment_method = 'credit_link'
     AND NULLIF(BTRIM(COALESCE(v_order.credit_payment_url, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Link de cartão ainda não configurado para este plano';
  END IF;

  UPDATE public.plan_orders
  SET
    payment_method = p_payment_method,
    status = 'awaiting_approval',
    payment_confirmed_at = now(),
    updated_at = now()
  WHERE id = v_order.id;

  RETURN v_order.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_plan_order(
  p_order_id UUID,
  p_decision TEXT,
  p_admin_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.plan_orders%ROWTYPE;
  v_latest public.student_plan_selections%ROWTYPE;
  v_decision TEXT;
  v_validity_days INT;
  v_candidate_expires_at TIMESTAMPTZ;
  v_new_expires_at TIMESTAMPTZ;
  v_new_remaining INT;
  v_selection_id UUID;
  v_notes TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  v_decision := LOWER(BTRIM(COALESCE(p_decision, '')));
  IF v_decision NOT IN ('approve', 'cancel') THEN
    RAISE EXCEPTION 'Decisão inválida. Use approve ou cancel';
  END IF;

  v_notes := NULLIF(BTRIM(COALESCE(p_admin_notes, '')), '');

  SELECT *
  INTO v_order
  FROM public.plan_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'Pedido não encontrado';
  END IF;

  IF v_order.status IN ('approved', 'cancelled') THEN
    RAISE EXCEPTION 'Pedido já finalizado';
  END IF;

  IF v_order.plan_type = 'fixed'
     AND v_order.status = 'pending_payment'
     AND now() > public.plan_order_payment_deadline_at(v_order.created_at) THEN
    UPDATE public.plan_orders
    SET
      status = 'cancelled',
      admin_notes = COALESCE(
        v_notes,
        NULLIF(BTRIM(admin_notes), ''),
        'Pedido cancelado automaticamente por expiração do prazo de pagamento.'
      ),
      approved_at = NULL,
      approved_by = NULL,
      updated_at = now()
    WHERE id = v_order.id;

    IF v_decision = 'cancel' THEN
      RETURN NULL;
    END IF;

    RAISE EXCEPTION 'Pedido expirado e cancelado automaticamente';
  END IF;

  IF v_decision = 'cancel' THEN
    UPDATE public.plan_orders
    SET
      status = 'cancelled',
      admin_notes = COALESCE(v_notes, admin_notes),
      approved_at = NULL,
      approved_by = auth.uid(),
      updated_at = now()
    WHERE id = v_order.id;

    RETURN NULL;
  END IF;

  IF v_order.plan_type = 'fixed' AND v_order.status <> 'awaiting_approval' THEN
    RAISE EXCEPTION 'O aluno ainda não confirmou o pagamento deste pedido';
  END IF;

  IF v_order.plan_type = 'custom' AND v_order.status NOT IN ('awaiting_contact', 'awaiting_approval') THEN
    RAISE EXCEPTION 'Status inválido para aprovação deste pedido personalizado';
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
    approved_by = auth.uid(),
    admin_notes = COALESCE(v_notes, admin_notes),
    credited_selection_id = v_selection_id,
    updated_at = now()
  WHERE id = v_order.id;

  PERFORM public.sync_student_month_credit_snapshot(v_order.user_id);

  RETURN v_selection_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_plan_order_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expiration_date DATE;
  v_wallet_expires_at TIMESTAMPTZ;
  v_message TEXT;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'approved' THEN
    IF NEW.credited_selection_id IS NOT NULL THEN
      SELECT sps.expires_at
      INTO v_wallet_expires_at
      FROM public.student_plan_selections sps
      WHERE sps.id = NEW.credited_selection_id;
    END IF;

    IF v_wallet_expires_at IS NOT NULL THEN
      v_expiration_date := (v_wallet_expires_at AT TIME ZONE 'America/Sao_Paulo')::date;
    ELSIF NEW.approved_at IS NOT NULL THEN
      v_expiration_date := ((NEW.approved_at + make_interval(days => NEW.validity_days)) AT TIME ZONE 'America/Sao_Paulo')::date;
    ELSE
      v_expiration_date := ((now() + make_interval(days => NEW.validity_days)) AT TIME ZONE 'America/Sao_Paulo')::date;
    END IF;

    v_message := format(
      'Seu pedido "%s" foi aprovado. %s créditos foram adicionados e a validade vai até %s.',
      NEW.plan_name,
      NEW.credits_amount,
      to_char(v_expiration_date, 'DD/MM/YYYY')
    );

    INSERT INTO public.notifications (user_id, type, title, message)
    VALUES (
      NEW.user_id,
      'credit_purchase_approved',
      'Créditos liberados',
      v_message
    );

    RETURN NEW;
  END IF;

  IF NEW.status = 'cancelled' THEN
    IF OLD.status = 'pending_payment'
       AND NEW.payment_confirmed_at IS NULL
       AND NEW.plan_type = 'fixed'
       AND NEW.approved_by IS NULL THEN
      v_message := format(
        'Seu pedido "%s" foi cancelado porque o prazo para informar o pagamento expirou.',
        NEW.plan_name
      );
    ELSE
      v_message := format(
        'Seu pedido "%s" foi cancelado. Entre em contato com o professor para mais detalhes.',
        NEW.plan_name
      );
    END IF;

    INSERT INTO public.notifications (user_id, type, title, message)
    VALUES (
      NEW.user_id,
      'credit_purchase_cancelled',
      'Pedido cancelado',
      v_message
    );

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;
