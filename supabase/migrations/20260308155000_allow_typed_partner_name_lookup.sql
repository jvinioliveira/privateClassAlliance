-- Allow typed partner input for double booking (first name + last name),
-- validating that partner exists as a student in the system.

DROP FUNCTION IF EXISTS public.book_slot(UUID, INT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.book_slot(UUID, INT, UUID);
DROP FUNCTION IF EXISTS public.book_slot(UUID, INT, TEXT);
DROP FUNCTION IF EXISTS public.book_slot(UUID, INT);

CREATE OR REPLACE FUNCTION public.book_slot(
  p_slot_id UUID,
  p_seats_reserved INT,
  p_partner_first_name TEXT DEFAULT NULL,
  p_partner_last_name TEXT DEFAULT NULL
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
  v_partner_first_name TEXT;
  v_partner_last_name TEXT;
  v_partner_student_id UUID;
  v_partner_name TEXT;
  v_match_count INT;
BEGIN
  IF p_seats_reserved NOT IN (1, 2) THEN
    RAISE EXCEPTION 'seats_reserved deve ser 1 ou 2';
  END IF;

  v_partner_first_name := NULLIF(BTRIM(COALESCE(p_partner_first_name, '')), '');
  v_partner_last_name := NULLIF(BTRIM(COALESCE(p_partner_last_name, '')), '');

  IF p_seats_reserved = 2 THEN
    IF v_partner_first_name IS NULL OR v_partner_last_name IS NULL THEN
      RAISE EXCEPTION 'Informe nome e sobrenome do segundo aluno para aula em dupla.';
    END IF;

    WITH matched_students AS (
      SELECT
        p.id,
        COALESCE(
          NULLIF(BTRIM(p.full_name), ''),
          NULLIF(BTRIM(concat_ws(' ', NULLIF(p.first_name, ''), NULLIF(p.last_name, ''))), ''),
          'Aluno parceiro'
        ) AS partner_name
      FROM public.profiles p
      WHERE p.role = 'student'
        AND p.id <> auth.uid()
        AND (
          (
            lower(BTRIM(COALESCE(p.first_name, ''))) = lower(v_partner_first_name)
            AND lower(BTRIM(COALESCE(p.last_name, ''))) = lower(v_partner_last_name)
          )
          OR lower(BTRIM(COALESCE(p.full_name, ''))) = lower(v_partner_first_name || ' ' || v_partner_last_name)
        )
    )
    SELECT
      COUNT(*)::INT,
      (ARRAY_AGG(ms.id ORDER BY ms.id))[1],
      (ARRAY_AGG(ms.partner_name ORDER BY ms.id))[1]
    INTO v_match_count, v_partner_student_id, v_partner_name
    FROM matched_students ms;

    IF COALESCE(v_match_count, 0) = 0 THEN
      RAISE EXCEPTION 'Aluno parceiro nao encontrado. Informe nome e sobrenome de um aluno cadastrado da Alliance Sao Jose dos Pinhais.';
    END IF;

    IF v_match_count > 1 THEN
      RAISE EXCEPTION 'Foi encontrado mais de um aluno com esse nome e sobrenome. Procure um nome mais especifico no cadastro.';
    END IF;
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

  SELECT * INTO v_slot FROM public.availability_slots WHERE id = p_slot_id FOR UPDATE;
  IF v_slot IS NULL THEN
    RAISE EXCEPTION 'Horario nao encontrado';
  END IF;
  IF v_slot.status != 'available' THEN
    RAISE EXCEPTION 'Horario nao esta disponivel';
  END IF;

  SELECT COALESCE(SUM(seats_reserved), 0) INTO v_booked_seats
  FROM public.bookings
  WHERE slot_id = p_slot_id
    AND status = 'booked';

  IF (v_slot.capacity - v_booked_seats) < p_seats_reserved THEN
    RAISE EXCEPTION 'Vagas insuficientes';
  END IF;

  v_booking_id := gen_random_uuid();

  INSERT INTO public.bookings (
    id,
    slot_id,
    student_id,
    seats_reserved,
    partner_name,
    partner_student_id,
    created_by_admin
  )
  VALUES (
    v_booking_id,
    p_slot_id,
    auth.uid(),
    p_seats_reserved,
    v_partner_name,
    v_partner_student_id,
    false
  );

  PERFORM public.consume_credit_for_booking(auth.uid(), v_booking_id);

  INSERT INTO public.notifications (user_id, type, title, message)
  VALUES (
    auth.uid(),
    'booking_confirmed',
    'Agendamento confirmado',
    'Sua aula foi agendada para ' || to_char(v_slot.start_time AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI')
  );

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
  RETURN public.book_slot(p_slot_id, p_seats_reserved, NULL::TEXT, NULL::TEXT);
END;
$$;
