-- Fix FK order for credit usage registration:
-- booking must exist before inserting student_credit_usages row.

CREATE OR REPLACE FUNCTION public.book_slot(p_slot_id UUID, p_seats_reserved INT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slot availability_slots%ROWTYPE;
  v_booked_seats INT;
  v_booking_id UUID;
BEGIN
  IF p_seats_reserved NOT IN (1, 2) THEN
    RAISE EXCEPTION 'seats_reserved deve ser 1 ou 2';
  END IF;

  SELECT * INTO v_slot FROM availability_slots WHERE id = p_slot_id FOR UPDATE;
  IF v_slot IS NULL THEN
    RAISE EXCEPTION 'Horario nao encontrado';
  END IF;
  IF v_slot.status != 'available' THEN
    RAISE EXCEPTION 'Horario nao esta disponivel';
  END IF;

  SELECT COALESCE(SUM(seats_reserved), 0) INTO v_booked_seats
  FROM bookings WHERE slot_id = p_slot_id AND status = 'booked';

  IF (v_slot.capacity - v_booked_seats) < p_seats_reserved THEN
    RAISE EXCEPTION 'Vagas insuficientes';
  END IF;

  v_booking_id := gen_random_uuid();

  INSERT INTO bookings (id, slot_id, student_id, seats_reserved, created_by_admin)
  VALUES (v_booking_id, p_slot_id, auth.uid(), p_seats_reserved, false);

  PERFORM public.consume_credit_for_booking(auth.uid(), v_booking_id);

  INSERT INTO notifications (user_id, type, title, message)
  VALUES (auth.uid(), 'booking_confirmed', 'Agendamento confirmado',
    'Sua aula foi agendada para ' || to_char(v_slot.start_time AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI'));

  RETURN v_booking_id;
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
  v_slot availability_slots%ROWTYPE;
  v_booked_seats INT;
  v_booking_id UUID;
BEGIN
  IF NOT is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Acesso negado: apenas admin';
  END IF;

  FOREACH v_slot_id IN ARRAY p_slot_ids LOOP
    BEGIN
      SELECT * INTO v_slot FROM availability_slots WHERE id = v_slot_id FOR UPDATE;
      IF v_slot IS NULL OR v_slot.status != 'available' THEN
        v_result := v_result || jsonb_build_object('slot_id', v_slot_id, 'success', false, 'error', 'Horario indisponivel');
        CONTINUE;
      END IF;

      SELECT COALESCE(SUM(seats_reserved), 0) INTO v_booked_seats
      FROM bookings WHERE slot_id = v_slot_id AND status = 'booked';

      IF (v_slot.capacity - v_booked_seats) < p_seats_reserved_default THEN
        v_result := v_result || jsonb_build_object('slot_id', v_slot_id, 'success', false, 'error', 'Sem vagas');
        CONTINUE;
      END IF;

      v_booking_id := gen_random_uuid();

      INSERT INTO bookings (id, slot_id, student_id, seats_reserved, created_by_admin)
      VALUES (v_booking_id, v_slot_id, p_student_id, p_seats_reserved_default, true);

      PERFORM public.consume_credit_for_booking(p_student_id, v_booking_id);

      v_result := v_result || jsonb_build_object('slot_id', v_slot_id, 'success', true, 'booking_id', v_booking_id);
    EXCEPTION WHEN OTHERS THEN
      v_result := v_result || jsonb_build_object('slot_id', v_slot_id, 'success', false, 'error', SQLERRM);
    END;
  END LOOP;

  INSERT INTO notifications (user_id, type, title, message)
  VALUES (p_student_id, 'bulk_booking', 'Aulas agendadas', 'O professor agendou aulas para voce.');

  RETURN v_result;
END;
$$;
