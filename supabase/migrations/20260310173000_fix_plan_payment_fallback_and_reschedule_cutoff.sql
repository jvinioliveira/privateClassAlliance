-- Fixes for payment and reschedule robustness:
-- 1) mark_plan_order_payment now supports plan payment fallback on server side
-- 2) reschedule_booking now enforces past/30min cutoff for students

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
  v_plan_pix_code TEXT;
  v_plan_pix_qr_image_url TEXT;
  v_plan_credit_payment_url TEXT;
  v_effective_pix_code TEXT;
  v_effective_pix_qr_image_url TEXT;
  v_effective_credit_payment_url TEXT;
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

  IF v_order.plan_id IS NOT NULL THEN
    SELECT lp.pix_code, lp.pix_qr_image_url, lp.credit_payment_url
    INTO v_plan_pix_code, v_plan_pix_qr_image_url, v_plan_credit_payment_url
    FROM public.lesson_plans lp
    WHERE lp.id = v_order.plan_id;
  END IF;

  v_effective_pix_code := COALESCE(
    NULLIF(BTRIM(COALESCE(v_order.pix_code, '')), ''),
    NULLIF(BTRIM(COALESCE(v_plan_pix_code, '')), '')
  );
  v_effective_pix_qr_image_url := COALESCE(
    NULLIF(BTRIM(COALESCE(v_order.pix_qr_image_url, '')), ''),
    NULLIF(BTRIM(COALESCE(v_plan_pix_qr_image_url, '')), '')
  );
  v_effective_credit_payment_url := COALESCE(
    NULLIF(BTRIM(COALESCE(v_order.credit_payment_url, '')), ''),
    NULLIF(BTRIM(COALESCE(v_plan_credit_payment_url, '')), '')
  );

  IF p_payment_method = 'pix'
     AND v_effective_pix_code IS NULL
     AND v_effective_pix_qr_image_url IS NULL THEN
    RAISE EXCEPTION 'PIX ainda não configurado para este plano';
  END IF;

  IF p_payment_method = 'credit_link'
     AND v_effective_credit_payment_url IS NULL THEN
    RAISE EXCEPTION 'Link de cartão ainda não configurado para este plano';
  END IF;

  UPDATE public.plan_orders
  SET
    payment_method = p_payment_method,
    status = 'awaiting_approval',
    payment_confirmed_at = now(),
    pix_code = COALESCE(v_order.pix_code, v_plan_pix_code),
    pix_qr_image_url = COALESCE(v_order.pix_qr_image_url, v_plan_pix_qr_image_url),
    credit_payment_url = COALESCE(v_order.credit_payment_url, v_plan_credit_payment_url),
    updated_at = now()
  WHERE id = v_order.id;

  RETURN v_order.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reschedule_booking(p_booking_id UUID, p_new_slot_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_old_slot public.availability_slots%ROWTYPE;
  v_new_slot public.availability_slots%ROWTYPE;
  v_slot_occupied BOOLEAN;
  v_is_admin BOOLEAN;
BEGIN
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id;

  IF v_booking IS NULL THEN
    RAISE EXCEPTION 'Agendamento não encontrado';
  END IF;

  v_is_admin := public.is_admin(auth.uid());

  IF v_booking.student_id <> auth.uid() AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  IF v_booking.status <> 'booked' THEN
    RAISE EXCEPTION 'Apenas agendamentos ativos podem ser remarcados';
  END IF;

  IF p_new_slot_id = v_booking.slot_id THEN
    RAISE EXCEPTION 'Escolha um novo horário para remarcar';
  END IF;

  SELECT * INTO v_old_slot
  FROM public.availability_slots
  WHERE id = v_booking.slot_id;

  SELECT * INTO v_new_slot
  FROM public.availability_slots
  WHERE id = p_new_slot_id
  FOR UPDATE;

  IF v_new_slot IS NULL OR v_new_slot.status <> 'available' THEN
    RAISE EXCEPTION 'Novo horário não disponível';
  END IF;

  IF v_new_slot.start_time <= now() THEN
    RAISE EXCEPTION 'Novo horário indisponível porque já passou';
  END IF;

  IF NOT v_is_admin THEN
    IF now() > (v_old_slot.start_time - INTERVAL '24 hours') THEN
      RAISE EXCEPTION 'Remarcação deve ser feita com pelo menos 24h de antecedência';
    END IF;

    IF v_new_slot.start_time <= (now() + INTERVAL '30 minutes') THEN
      RAISE EXCEPTION 'Remarcação indisponível com menos de 30 minutos de antecedência';
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.bookings b
    WHERE b.slot_id = p_new_slot_id
      AND b.status = 'booked'
      AND b.id <> p_booking_id
  )
  INTO v_slot_occupied;

  IF v_slot_occupied THEN
    RAISE EXCEPTION 'Novo horário indisponível';
  END IF;

  UPDATE public.bookings
  SET slot_id = p_new_slot_id,
      updated_at = now()
  WHERE id = p_booking_id;

  INSERT INTO public.notifications (user_id, type, title, message)
  VALUES (
    v_booking.student_id,
    'booking_rescheduled',
    'Aula remarcada',
    'Sua aula foi remarcada para ' || to_char(v_new_slot.start_time AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI')
  );

  PERFORM public.process_waitlist(v_booking.slot_id);
END;
$$;
