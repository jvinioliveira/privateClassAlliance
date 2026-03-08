-- Allow rebooking after cancellation while controlling abuse.
-- Rules added:
-- 1) Student can rebook same slot after cancel (remove global unique by slot/student).
-- 2) Keep only one active booking per slot/student (partial unique index on status = booked).
-- 3) Student can book the same slot at most 3 times in total.
-- 4) Student cancellation returns warning message with remaining rebook attempts.
-- 5) Student cannot cancel within 24h (credit remains consumed).

ALTER TABLE public.bookings
DROP CONSTRAINT IF EXISTS bookings_slot_id_student_id_key;

DROP INDEX IF EXISTS idx_bookings_unique_active_per_slot_student;
CREATE UNIQUE INDEX idx_bookings_unique_active_per_slot_student
ON public.bookings (slot_id, student_id)
WHERE status = 'booked';

CREATE OR REPLACE FUNCTION public.book_slot(p_slot_id UUID, p_seats_reserved INT, p_partner_name TEXT DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slot availability_slots%ROWTYPE;
  v_booked_seats INT;
  v_booking_id UUID;
  v_partner_name TEXT;
  v_existing_active UUID;
  v_total_attempts INT;
BEGIN
  IF p_seats_reserved NOT IN (1, 2) THEN
    RAISE EXCEPTION 'seats_reserved deve ser 1 ou 2';
  END IF;

  v_partner_name := NULLIF(BTRIM(COALESCE(p_partner_name, '')), '');

  IF p_seats_reserved = 2 AND v_partner_name IS NULL THEN
    RAISE EXCEPTION 'Informe o nome da segunda pessoa para agendar aula em dupla.';
  END IF;

  SELECT b.id
  INTO v_existing_active
  FROM public.bookings b
  WHERE b.slot_id = p_slot_id
    AND b.student_id = auth.uid()
    AND b.status = 'booked'
  LIMIT 1;

  IF v_existing_active IS NOT NULL THEN
    RAISE EXCEPTION 'Voce ja esta agendado neste horario.';
  END IF;

  SELECT COUNT(*)::INT
  INTO v_total_attempts
  FROM public.bookings b
  WHERE b.slot_id = p_slot_id
    AND b.student_id = auth.uid();

  IF v_total_attempts >= 3 THEN
    RAISE EXCEPTION 'Limite atingido: voce ja agendou este horario 3 vezes e nao pode marcar novamente.';
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

  INSERT INTO bookings (id, slot_id, student_id, seats_reserved, partner_name, created_by_admin)
  VALUES (v_booking_id, p_slot_id, auth.uid(), p_seats_reserved, v_partner_name, false);

  PERFORM public.consume_credit_for_booking(auth.uid(), v_booking_id);

  INSERT INTO notifications (user_id, type, title, message)
  VALUES (auth.uid(), 'booking_confirmed', 'Agendamento confirmado',
    'Sua aula foi agendada para ' || to_char(v_slot.start_time AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI'));

  RETURN v_booking_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.book_slot(p_slot_id UUID, p_seats_reserved INT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.book_slot(p_slot_id, p_seats_reserved, NULL);
END;
$$;

DROP FUNCTION IF EXISTS public.cancel_booking(UUID);

CREATE OR REPLACE FUNCTION public.cancel_booking(p_booking_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking bookings%ROWTYPE;
  v_slot availability_slots%ROWTYPE;
  v_is_admin BOOLEAN;
  v_total_attempts INT := 0;
  v_remaining_attempts INT := 0;
  v_warning_message TEXT := NULL;
  v_notification_message TEXT := 'Seu agendamento foi cancelado.';
BEGIN
  SELECT * INTO v_booking FROM bookings WHERE id = p_booking_id;
  IF v_booking IS NULL THEN
    RAISE EXCEPTION 'Agendamento nao encontrado';
  END IF;

  v_is_admin := is_admin(auth.uid());

  IF v_booking.student_id != auth.uid() AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Sem permissao';
  END IF;

  IF v_booking.status != 'booked' THEN
    RAISE EXCEPTION 'Apenas agendamentos ativos podem ser cancelados';
  END IF;

  IF NOT v_is_admin THEN
    SELECT * INTO v_slot FROM availability_slots WHERE id = v_booking.slot_id;
    IF now() > (v_slot.start_time - INTERVAL '24 hours') THEN
      RAISE EXCEPTION 'Cancelamento nao permitido com menos de 24h. O credito desta aula sera mantido como utilizado.';
    END IF;
  END IF;

  UPDATE bookings
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_booking_id;

  PERFORM public.restore_credit_for_booking(p_booking_id);

  IF NOT v_is_admin THEN
    SELECT COUNT(*)::INT
    INTO v_total_attempts
    FROM public.bookings b
    WHERE b.slot_id = v_booking.slot_id
      AND b.student_id = v_booking.student_id;

    v_remaining_attempts := GREATEST(3 - v_total_attempts, 0);

    v_warning_message := CASE
      WHEN v_remaining_attempts >= 2 THEN format('Voce pode agendar este mesmo horario mais %s vezes.', v_remaining_attempts)
      WHEN v_remaining_attempts = 1 THEN 'Voce pode agendar este mesmo horario mais 1 vez.'
      ELSE 'Voce atingiu o limite e nao pode mais agendar este mesmo horario.'
    END;

    v_notification_message := v_notification_message || ' ' || v_warning_message;
  END IF;

  INSERT INTO notifications (user_id, type, title, message)
  VALUES (v_booking.student_id, 'booking_cancelled', 'Aula cancelada', v_notification_message);

  PERFORM process_waitlist(v_booking.slot_id);

  RETURN jsonb_build_object(
    'cancelled', true,
    'remaining_rebook_attempts', CASE WHEN v_is_admin THEN NULL::INT ELSE v_remaining_attempts END,
    'warning_message', CASE WHEN v_is_admin THEN NULL::TEXT ELSE v_warning_message END
  );
END;
$$;
