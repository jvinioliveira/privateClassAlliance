-- Lock manual payment confirmation to NuPay (credit_link) only.

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
  v_plan_credit_payment_url TEXT;
  v_effective_credit_payment_url TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuario nao autenticado';
  END IF;

  IF p_payment_method <> 'credit_link' THEN
    RAISE EXCEPTION 'Metodo de pagamento invalido. Use credit_link';
  END IF;

  PERFORM public.expire_stale_plan_orders(auth.uid());

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

  IF v_order.status = 'cancelled' THEN
    RAISE EXCEPTION 'Este pedido foi cancelado';
  END IF;

  IF v_order.status = 'approved' THEN
    RAISE EXCEPTION 'Este pedido ja foi aprovado';
  END IF;

  IF v_order.status = 'awaiting_approval' THEN
    RAISE EXCEPTION 'Pagamento ja informado. Aguarde a aprovacao do professor';
  END IF;

  IF v_order.status <> 'pending_payment' THEN
    RAISE EXCEPTION 'Status invalido para confirmacao de pagamento';
  END IF;

  IF now() > public.plan_order_payment_deadline_at(v_order.created_at) THEN
    UPDATE public.plan_orders
    SET
      status = 'cancelled',
      admin_notes = COALESCE(
        NULLIF(BTRIM(admin_notes), ''),
        'Pedido cancelado automaticamente por expiracao do prazo de pagamento.'
      ),
      updated_at = now()
    WHERE id = v_order.id;

    RAISE EXCEPTION 'Prazo de pagamento expirado. Crie um novo pedido para continuar';
  END IF;

  IF v_order.plan_id IS NOT NULL THEN
    SELECT lp.credit_payment_url
    INTO v_plan_credit_payment_url
    FROM public.lesson_plans lp
    WHERE lp.id = v_order.plan_id;
  END IF;

  v_effective_credit_payment_url := COALESCE(
    NULLIF(BTRIM(COALESCE(v_order.credit_payment_url, '')), ''),
    NULLIF(BTRIM(COALESCE(v_plan_credit_payment_url, '')), '')
  );

  IF v_effective_credit_payment_url IS NULL THEN
    RAISE EXCEPTION 'Link de pagamento NuPay ainda nao configurado para este plano';
  END IF;

  UPDATE public.plan_orders
  SET
    payment_method = 'credit_link',
    status = 'awaiting_approval',
    payment_confirmed_at = now(),
    pix_code = NULL,
    pix_qr_image_url = NULL,
    credit_payment_url = COALESCE(v_order.credit_payment_url, v_plan_credit_payment_url),
    updated_at = now()
  WHERE id = v_order.id;

  RETURN v_order.id;
END;
$$;
