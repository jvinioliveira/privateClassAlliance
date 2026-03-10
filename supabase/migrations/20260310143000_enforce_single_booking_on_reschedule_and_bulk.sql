-- Enforce "one class per slot" across backend flows:
-- 1) reschedule_booking cannot move to a slot that already has an active booking
-- 2) admin_bulk_book cannot create a booking in a slot that already has an active booking

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
BEGIN
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id;

  IF v_booking IS NULL THEN
    RAISE EXCEPTION 'Agendamento nao encontrado';
  END IF;

  IF v_booking.student_id != auth.uid() AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissao';
  END IF;

  IF v_booking.status <> 'booked' THEN
    RAISE EXCEPTION 'Apenas agendamentos ativos podem ser remarcados';
  END IF;

  IF p_new_slot_id = v_booking.slot_id THEN
    RAISE EXCEPTION 'Escolha um novo horario para remarcar';
  END IF;

  SELECT * INTO v_old_slot
  FROM public.availability_slots
  WHERE id = v_booking.slot_id;

  SELECT * INTO v_new_slot
  FROM public.availability_slots
  WHERE id = p_new_slot_id
  FOR UPDATE;

  IF v_new_slot IS NULL OR v_new_slot.status != 'available' THEN
    RAISE EXCEPTION 'Novo horario nao disponivel';
  END IF;

  IF NOT public.is_admin(auth.uid()) THEN
    IF now() > (v_old_slot.start_time - INTERVAL '24 hours') THEN
      RAISE EXCEPTION 'Remarcacao deve ser feita com pelo menos 24h de antecedencia';
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
    RAISE EXCEPTION 'Novo horario indisponivel';
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

CREATE OR REPLACE FUNCTION public.admin_bulk_book(
  p_student_id UUID,
  p_slot_ids UUID[],
  p_seats_reserved_default INT DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slot_id UUID;
  v_result JSONB := '[]'::JSONB;
  v_slot public.availability_slots%ROWTYPE;
  v_booking_id UUID;
  v_slot_occupied BOOLEAN;
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Acesso negado: apenas admin';
  END IF;

  IF p_seats_reserved_default NOT IN (1, 2) THEN
    RAISE EXCEPTION 'seats_reserved deve ser 1 ou 2';
  END IF;

  FOREACH v_slot_id IN ARRAY p_slot_ids LOOP
    BEGIN
      SELECT * INTO v_slot
      FROM public.availability_slots
      WHERE id = v_slot_id
      FOR UPDATE;

      IF v_slot IS NULL OR v_slot.status != 'available' THEN
        v_result := v_result || jsonb_build_object('slot_id', v_slot_id, 'success', false, 'error', 'Horario indisponivel');
        CONTINUE;
      END IF;

      SELECT EXISTS (
        SELECT 1
        FROM public.bookings b
        WHERE b.slot_id = v_slot_id
          AND b.status = 'booked'
      )
      INTO v_slot_occupied;

      IF v_slot_occupied THEN
        v_result := v_result || jsonb_build_object('slot_id', v_slot_id, 'success', false, 'error', 'Horario ocupado');
        CONTINUE;
      END IF;

      v_booking_id := gen_random_uuid();

      INSERT INTO public.bookings (id, slot_id, student_id, seats_reserved, created_by_admin)
      VALUES (v_booking_id, v_slot_id, p_student_id, p_seats_reserved_default, true);

      PERFORM public.consume_credit_for_booking(p_student_id, v_booking_id);

      v_result := v_result || jsonb_build_object('slot_id', v_slot_id, 'success', true, 'booking_id', v_booking_id);
    EXCEPTION WHEN OTHERS THEN
      v_result := v_result || jsonb_build_object('slot_id', v_slot_id, 'success', false, 'error', SQLERRM);
    END;
  END LOOP;

  INSERT INTO public.notifications (user_id, type, title, message)
  VALUES (p_student_id, 'bulk_booking', 'Aulas agendadas', 'O professor agendou aulas para voce.');

  RETURN v_result;
END;
$$;
