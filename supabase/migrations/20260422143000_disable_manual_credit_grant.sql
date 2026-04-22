-- Disable manual credit granting via admin review.
-- Plan order approval is now exclusively handled by Stripe webhook automation.

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
  v_decision TEXT;
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

  IF v_decision = 'approve' THEN
    RAISE EXCEPTION 'Aprovação manual desativada. Créditos são liberados automaticamente após pagamento confirmado.';
  END IF;

  UPDATE public.plan_orders
  SET
    status = 'cancelled',
    admin_notes = COALESCE(v_notes, admin_notes),
    approved_at = NULL,
    approved_by = auth.uid(),
    updated_at = now()
  WHERE id = v_order.id;

  RETURN NULL;
END;
$$;

