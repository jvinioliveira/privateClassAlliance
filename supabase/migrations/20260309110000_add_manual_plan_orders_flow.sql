-- Manual plan purchase flow:
-- 1) student creates an order request (fixed/custom)
-- 2) payment is confirmed manually
-- 3) admin approves/cancels
-- 4) credits are granted only when approved

ALTER TABLE public.lesson_plans
ADD COLUMN IF NOT EXISTS pix_code TEXT,
ADD COLUMN IF NOT EXISTS pix_qr_image_url TEXT,
ADD COLUMN IF NOT EXISTS credit_payment_url TEXT;

ALTER TABLE public.student_plan_selections
ADD COLUMN IF NOT EXISTS class_type TEXT;

UPDATE public.student_plan_selections sps
SET class_type = lp.class_type
FROM public.lesson_plans lp
WHERE sps.class_type IS NULL
  AND sps.plan_id = lp.id;

UPDATE public.student_plan_selections
SET class_type = 'individual'
WHERE class_type IS NULL;

ALTER TABLE public.student_plan_selections
ALTER COLUMN class_type SET NOT NULL;

ALTER TABLE public.student_plan_selections
DROP CONSTRAINT IF EXISTS student_plan_selections_class_type_check;

ALTER TABLE public.student_plan_selections
ADD CONSTRAINT student_plan_selections_class_type_check
CHECK (class_type IN ('individual', 'double'));

ALTER TABLE public.student_plan_selections
ALTER COLUMN plan_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS public.plan_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES public.lesson_plans(id) ON DELETE SET NULL,
  plan_name TEXT NOT NULL,
  plan_type TEXT NOT NULL CHECK (plan_type IN ('fixed', 'custom')),
  class_type TEXT NOT NULL CHECK (class_type IN ('individual', 'double')),
  credits_amount INT NOT NULL CHECK (credits_amount > 0),
  validity_days INT NOT NULL CHECK (validity_days > 0),
  price_amount_cents INT NOT NULL CHECK (price_amount_cents >= 0),
  payment_method TEXT CHECK (payment_method IN ('pix', 'credit_link', 'manual_contact')),
  status TEXT NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment', 'awaiting_approval', 'approved', 'cancelled', 'awaiting_contact')),
  pix_code TEXT,
  pix_qr_image_url TEXT,
  credit_payment_url TEXT,
  custom_quantity INT CHECK (custom_quantity IS NULL OR custom_quantity > 0),
  admin_notes TEXT,
  payment_confirmed_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  credited_selection_id UUID REFERENCES public.student_plan_selections(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_orders_user_created
ON public.plan_orders (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_plan_orders_status_created
ON public.plan_orders (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_plan_orders_plan_type
ON public.plan_orders (plan_type);

ALTER TABLE public.plan_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students can view own plan orders" ON public.plan_orders;
CREATE POLICY "Students can view own plan orders"
  ON public.plan_orders FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can manage all plan orders" ON public.plan_orders;
CREATE POLICY "Admins can manage all plan orders"
  ON public.plan_orders FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

DROP TRIGGER IF EXISTS update_plan_orders_updated_at ON public.plan_orders;
CREATE TRIGGER update_plan_orders_updated_at
  BEFORE UPDATE ON public.plan_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.get_plan_validity_days(p_credits INT)
RETURNS INT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_credits IS NULL OR p_credits <= 0 THEN
    RETURN 30;
  END IF;

  RETURN CASE
    WHEN p_credits = 1 THEN 15
    WHEN p_credits >= 10 THEN 45
    ELSE 30
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_custom_plan_unit_price_cents(p_class_type TEXT, p_credits INT)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_class_type = 'double' THEN
    RETURN CASE
      WHEN p_credits <= 1 THEN 15000
      WHEN p_credits <= 3 THEN 14550
      WHEN p_credits <= 7 THEN 14250
      WHEN p_credits <= 11 THEN 13500
      ELSE 12500
    END;
  END IF;

  RETURN CASE
    WHEN p_credits <= 1 THEN 10000
    WHEN p_credits <= 3 THEN 9700
    WHEN p_credits <= 7 THEN 9500
    WHEN p_credits <= 11 THEN 9000
    ELSE (100000::NUMERIC / 12::NUMERIC)
  END;
END;
$$;

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
    RAISE EXCEPTION 'Usuario nao autenticado';
  END IF;

  SELECT *
  INTO v_plan
  FROM public.lesson_plans
  WHERE id = p_plan_id
    AND is_active = true;

  IF v_plan IS NULL THEN
    RAISE EXCEPTION 'Plano nao encontrado ou inativo';
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

CREATE OR REPLACE FUNCTION public.create_custom_plan_order(
  p_class_type TEXT,
  p_custom_quantity INT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id UUID;
  v_class_type TEXT;
  v_unit_price NUMERIC;
  v_total_price INT;
  v_plan_name TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuario nao autenticado';
  END IF;

  IF p_class_type NOT IN ('individual', 'double') THEN
    RAISE EXCEPTION 'Tipo de plano invalido';
  END IF;

  v_class_type := p_class_type;

  IF p_custom_quantity IS NULL OR p_custom_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantidade de creditos invalida';
  END IF;

  IF p_custom_quantity > 100 THEN
    RAISE EXCEPTION 'Quantidade maxima para compra personalizada: 100 creditos';
  END IF;

  v_unit_price := public.get_custom_plan_unit_price_cents(v_class_type, p_custom_quantity);
  v_total_price := ROUND(v_unit_price * p_custom_quantity)::INT;
  v_plan_name := format(
    'Plano personalizado %s - %s %s',
    CASE WHEN v_class_type = 'double' THEN 'dupla' ELSE 'individual' END,
    p_custom_quantity,
    CASE WHEN p_custom_quantity = 1 THEN 'aula' ELSE 'aulas' END
  );

  INSERT INTO public.plan_orders (
    user_id,
    plan_id,
    plan_name,
    plan_type,
    class_type,
    credits_amount,
    validity_days,
    price_amount_cents,
    payment_method,
    status,
    custom_quantity
  )
  VALUES (
    auth.uid(),
    NULL,
    v_plan_name,
    'custom',
    v_class_type,
    p_custom_quantity,
    public.get_plan_validity_days(p_custom_quantity),
    v_total_price,
    'manual_contact',
    'awaiting_contact',
    p_custom_quantity
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
    RAISE EXCEPTION 'Usuario nao autenticado';
  END IF;

  IF p_payment_method NOT IN ('pix', 'credit_link') THEN
    RAISE EXCEPTION 'Metodo de pagamento invalido';
  END IF;

  SELECT *
  INTO v_order
  FROM public.plan_orders
  WHERE id = p_order_id
    AND user_id = auth.uid()
  FOR UPDATE;

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'Pedido nao encontrado';
  END IF;

  IF v_order.plan_type <> 'fixed' THEN
    RAISE EXCEPTION 'Este pedido nao utiliza etapa de pagamento padrao';
  END IF;

  IF v_order.status IN ('approved', 'cancelled') THEN
    RAISE EXCEPTION 'Pedido ja finalizado';
  END IF;

  UPDATE public.plan_orders
  SET payment_method = p_payment_method,
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
    RAISE EXCEPTION 'Decisao invalida. Use approve ou cancel';
  END IF;

  v_notes := NULLIF(BTRIM(COALESCE(p_admin_notes, '')), '');

  SELECT *
  INTO v_order
  FROM public.plan_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order IS NULL THEN
    RAISE EXCEPTION 'Pedido nao encontrado';
  END IF;

  IF v_order.status IN ('approved', 'cancelled') THEN
    RAISE EXCEPTION 'Pedido ja finalizado';
  END IF;

  IF v_decision = 'cancel' THEN
    UPDATE public.plan_orders
    SET status = 'cancelled',
        admin_notes = COALESCE(v_notes, admin_notes),
        approved_at = NULL,
        approved_by = auth.uid(),
        updated_at = now()
    WHERE id = v_order.id;

    RETURN NULL;
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
  SET status = 'approved',
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

CREATE OR REPLACE FUNCTION public.get_student_available_credits(p_student_id UUID DEFAULT auth.uid())
RETURNS INT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_available INT;
BEGIN
  IF p_student_id IS NULL THEN
    RETURN 0;
  END IF;

  WITH ranked_wallets AS (
    SELECT
      sps.remaining_credits,
      sps.expires_at,
      sps.class_type,
      ROW_NUMBER() OVER (
        PARTITION BY sps.class_type
        ORDER BY sps.selected_at DESC, sps.updated_at DESC, sps.id DESC
      ) AS rn
    FROM public.student_plan_selections sps
    WHERE sps.student_id = p_student_id
      AND sps.status = 'active'
  )
  SELECT COALESCE(
    SUM(
      CASE
        WHEN rw.rn = 1 AND rw.expires_at > now() THEN GREATEST(COALESCE(rw.remaining_credits, 0), 0)
        ELSE 0
      END
    ),
    0
  )::INT
  INTO v_available
  FROM ranked_wallets rw;

  RETURN COALESCE(v_available, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_credit_for_booking(p_student_id UUID, p_booking_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet public.student_plan_selections%ROWTYPE;
  v_required_class_type TEXT;
BEGIN
  IF p_student_id IS NULL THEN
    RAISE EXCEPTION 'Aluno invalido';
  END IF;

  IF p_booking_id IS NULL THEN
    RAISE EXCEPTION 'Agendamento invalido';
  END IF;

  SELECT CASE WHEN b.seats_reserved = 2 THEN 'double' ELSE 'individual' END
  INTO v_required_class_type
  FROM public.bookings b
  WHERE b.id = p_booking_id;

  IF v_required_class_type IS NULL THEN
    RAISE EXCEPTION 'Agendamento nao encontrado para consumir credito';
  END IF;

  SELECT sps.*
  INTO v_wallet
  FROM public.student_plan_selections sps
  WHERE sps.student_id = p_student_id
    AND sps.status = 'active'
    AND sps.class_type = v_required_class_type
  ORDER BY sps.selected_at DESC, sps.updated_at DESC, sps.id DESC
  LIMIT 1
  FOR UPDATE OF sps;

  IF v_wallet IS NULL THEN
    IF v_required_class_type = 'double' THEN
      RAISE EXCEPTION 'Sem creditos de aula em dupla. Compre um plano em dupla para agendar.';
    END IF;

    RAISE EXCEPTION 'Sem creditos de aula individual. Compre um plano individual para agendar.';
  END IF;

  IF v_wallet.expires_at <= now() THEN
    RAISE EXCEPTION 'Seus creditos expiraram. Compre um novo plano para continuar.';
  END IF;

  IF COALESCE(v_wallet.remaining_credits, 0) <= 0 THEN
    IF v_required_class_type = 'double' THEN
      RAISE EXCEPTION 'Sem creditos de aula em dupla. Compre um plano em dupla para agendar.';
    END IF;

    RAISE EXCEPTION 'Sem creditos de aula individual. Compre um plano individual para agendar.';
  END IF;

  UPDATE public.student_plan_selections
  SET remaining_credits = remaining_credits - 1,
      updated_at = now()
  WHERE id = v_wallet.id;

  INSERT INTO public.student_credit_usages (
    booking_id,
    selection_id,
    student_id,
    credits_used
  )
  VALUES (
    p_booking_id,
    v_wallet.id,
    p_student_id,
    1
  );

  PERFORM public.sync_student_month_credit_snapshot(p_student_id);

  RETURN v_wallet.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_due_credit_expiry(p_user_id UUID DEFAULT NULL)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_selection RECORD;
  v_expiration_date DATE;
  v_today_br DATE;
  v_days_remaining INT;
  v_message TEXT;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());

  IF v_user_id IS NULL THEN
    RETURN 0;
  END IF;

  WITH ranked_wallets AS (
    SELECT
      sps.id,
      sps.student_id,
      sps.expires_at,
      sps.remaining_credits,
      sps.class_type,
      ROW_NUMBER() OVER (
        PARTITION BY sps.class_type
        ORDER BY sps.selected_at DESC, sps.updated_at DESC, sps.id DESC
      ) AS rn
    FROM public.student_plan_selections sps
    WHERE sps.student_id = v_user_id
      AND sps.status = 'active'
  )
  SELECT rw.id, rw.student_id, rw.expires_at, rw.remaining_credits, rw.class_type
  INTO v_selection
  FROM ranked_wallets rw
  WHERE rw.rn = 1
    AND rw.expires_at > now()
    AND COALESCE(rw.remaining_credits, 0) > 0
  ORDER BY rw.expires_at ASC
  LIMIT 1;

  IF v_selection IS NULL THEN
    RETURN 0;
  END IF;

  v_expiration_date := (v_selection.expires_at AT TIME ZONE 'America/Sao_Paulo')::date;
  v_today_br := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_days_remaining := v_expiration_date - v_today_br;

  IF v_days_remaining <> 3 THEN
    RETURN 0;
  END IF;

  v_message := format(
    'Seus creditos de %s expiram em 3 dias (%s).',
    CASE WHEN v_selection.class_type = 'double' THEN 'aula em dupla' ELSE 'aula individual' END,
    to_char(v_expiration_date, 'DD/MM/YYYY')
  );

  IF EXISTS (
    SELECT 1
    FROM public.notifications n
    WHERE n.user_id = v_user_id
      AND n.type = 'credits_expiring_soon'
      AND n.message = v_message
  ) THEN
    RETURN 0;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, message)
  VALUES (
    v_user_id,
    'credits_expiring_soon',
    'Creditos perto de expirar',
    v_message
  );

  RETURN 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.choose_plan(
  p_plan_id UUID,
  p_month_ref DATE DEFAULT public.get_month_ref(now())
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.lesson_plans%ROWTYPE;
  v_latest public.student_plan_selections%ROWTYPE;
  v_selection_id UUID;
  v_validity_days INT;
  v_candidate_expires_at TIMESTAMPTZ;
  v_new_expires_at TIMESTAMPTZ;
  v_new_remaining INT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'choose_plan desativado para alunos; use o fluxo de pedidos de compra';
  END IF;

  SELECT *
  INTO v_plan
  FROM public.lesson_plans
  WHERE id = p_plan_id
    AND is_active = true;

  IF v_plan IS NULL THEN
    RAISE EXCEPTION 'Plano nao encontrado ou inativo';
  END IF;

  v_validity_days := public.get_plan_validity_days(v_plan.credits);
  v_candidate_expires_at := now() + make_interval(days => v_validity_days);

  SELECT sps.*
  INTO v_latest
  FROM public.student_plan_selections sps
  WHERE sps.student_id = auth.uid()
    AND sps.status = 'active'
    AND sps.class_type = v_plan.class_type
  ORDER BY sps.selected_at DESC, sps.updated_at DESC, sps.id DESC
  LIMIT 1
  FOR UPDATE OF sps;

  IF v_latest IS NULL OR v_latest.expires_at <= now() THEN
    v_new_remaining := v_plan.credits;
    v_new_expires_at := v_candidate_expires_at;
  ELSE
    v_new_remaining := GREATEST(COALESCE(v_latest.remaining_credits, 0), 0) + v_plan.credits;
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
    auth.uid(),
    v_plan.id,
    COALESCE(p_month_ref, public.get_month_ref(now())),
    v_plan.credits,
    v_new_remaining,
    v_plan.price_cents,
    'active',
    now(),
    v_new_expires_at,
    now(),
    v_plan.class_type
  )
  RETURNING id INTO v_selection_id;

  PERFORM public.sync_student_month_credit_snapshot(auth.uid());

  RETURN v_selection_id;
END;
$$;
