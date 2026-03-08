-- Require registered student partner for double classes.
-- Partner can vary each booking, but must be an enrolled student in the platform
-- (Alliance Sao Jose dos Pinhais base).

ALTER TABLE public.bookings
ADD COLUMN IF NOT EXISTS partner_student_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_partner_student_id
ON public.bookings (partner_student_id);

DROP POLICY IF EXISTS "Students can view student profiles for partner selection" ON public.profiles;
CREATE POLICY "Students can view student profiles for partner selection"
  ON public.profiles FOR SELECT
  USING (auth.uid() IS NOT NULL AND role = 'student');

DROP FUNCTION IF EXISTS public.book_slot(UUID, INT, TEXT);
DROP FUNCTION IF EXISTS public.book_slot(UUID, INT, UUID);

CREATE OR REPLACE FUNCTION public.book_slot(
  p_slot_id UUID,
  p_seats_reserved INT,
  p_partner_student_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slot availability_slots%ROWTYPE;
  v_booked_seats INT;
  v_booking_id UUID;
  v_existing_active UUID;
  v_total_attempts INT;
  v_partner_student public.profiles%ROWTYPE;
  v_partner_student_id UUID;
  v_partner_name TEXT;
BEGIN
  IF p_seats_reserved NOT IN (1, 2) THEN
    RAISE EXCEPTION 'seats_reserved deve ser 1 ou 2';
  END IF;

  v_partner_student_id := p_partner_student_id;

  IF p_seats_reserved = 2 THEN
    IF v_partner_student_id IS NULL THEN
      RAISE EXCEPTION 'Selecione o segundo aluno para agendar aula em dupla.';
    END IF;

    IF v_partner_student_id = auth.uid() THEN
      RAISE EXCEPTION 'O segundo aluno deve ser diferente de voce.';
    END IF;

    SELECT *
    INTO v_partner_student
    FROM public.profiles p
    WHERE p.id = v_partner_student_id
      AND p.role = 'student';

    IF v_partner_student.id IS NULL THEN
      RAISE EXCEPTION 'O segundo aluno deve ser um aluno cadastrado da Alliance Sao Jose dos Pinhais.';
    END IF;

    v_partner_name := COALESCE(
      NULLIF(BTRIM(v_partner_student.full_name), ''),
      NULLIF(BTRIM(concat_ws(' ', NULLIF(v_partner_student.first_name, ''), NULLIF(v_partner_student.last_name, ''))), ''),
      'Aluno parceiro'
    );
  ELSE
    v_partner_student_id := NULL;
    v_partner_name := NULL;
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

  INSERT INTO bookings (id, slot_id, student_id, seats_reserved, partner_name, partner_student_id, created_by_admin)
  VALUES (v_booking_id, p_slot_id, auth.uid(), p_seats_reserved, v_partner_name, v_partner_student_id, false);

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
  RETURN public.book_slot(p_slot_id, p_seats_reserved, NULL::UUID);
END;
$$;
