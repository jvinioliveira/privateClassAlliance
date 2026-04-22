-- Ensure authenticated users always have a profile row before creating plan orders.
-- This prevents FK errors on plan_orders.user_id -> profiles.id for legacy accounts.

CREATE OR REPLACE FUNCTION public.ensure_authenticated_profile()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario nao autenticado';
  END IF;

  INSERT INTO public.profiles (id, role)
  VALUES (v_user_id, 'student')
  ON CONFLICT (id) DO NOTHING;

  RETURN v_user_id;
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
  v_user_id UUID;
BEGIN
  v_user_id := public.ensure_authenticated_profile();

  PERFORM public.expire_stale_plan_orders(v_user_id);

  SELECT *
  INTO v_plan
  FROM public.lesson_plans
  WHERE id = p_plan_id
    AND is_active = true;

  IF v_plan IS NULL THEN
    RAISE EXCEPTION 'Plano nao encontrado ou inativo';
  END IF;

  SELECT po.id
  INTO v_order_id
  FROM public.plan_orders po
  WHERE po.user_id = v_user_id
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
    v_user_id,
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
  v_user_id UUID;
BEGIN
  v_user_id := public.ensure_authenticated_profile();

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
    v_user_id,
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
