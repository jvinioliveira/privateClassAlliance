-- Enforce class-specific credit usage and require partner name for double bookings.
-- Rules:
-- - individual credits can only book individual lessons
-- - double credits can only book double lessons
-- - double booking from student flow requires partner name

ALTER TABLE public.bookings
ADD COLUMN IF NOT EXISTS partner_name TEXT;

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
      lp.class_type,
      ROW_NUMBER() OVER (
        PARTITION BY lp.class_type
        ORDER BY sps.selected_at DESC, sps.updated_at DESC, sps.id DESC
      ) AS rn
    FROM public.student_plan_selections sps
    JOIN public.lesson_plans lp ON lp.id = sps.plan_id
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
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuario nao autenticado';
  END IF;

  SELECT * INTO v_plan
  FROM public.lesson_plans
  WHERE id = p_plan_id
    AND is_active = true;

  IF v_plan IS NULL THEN
    RAISE EXCEPTION 'Plano nao encontrado ou inativo';
  END IF;

  v_validity_days := CASE
    WHEN v_plan.credits = 1 THEN 15
    WHEN v_plan.credits >= 10 THEN 45
    ELSE 30
  END;

  v_candidate_expires_at := now() + make_interval(days => v_validity_days);

  SELECT sps.*
  INTO v_latest
  FROM public.student_plan_selections sps
  JOIN public.lesson_plans lp ON lp.id = sps.plan_id
  WHERE sps.student_id = auth.uid()
    AND sps.status = 'active'
    AND lp.class_type = v_plan.class_type
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
    updated_at
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
    now()
  )
  RETURNING id INTO v_selection_id;

  PERFORM public.sync_student_month_credit_snapshot(auth.uid());

  RETURN v_selection_id;
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
  JOIN public.lesson_plans lp ON lp.id = sps.plan_id
  WHERE sps.student_id = p_student_id
    AND sps.status = 'active'
    AND lp.class_type = v_required_class_type
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

CREATE OR REPLACE FUNCTION public.restore_credit_for_booking(p_booking_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usage public.student_credit_usages%ROWTYPE;
BEGIN
  SELECT *
  INTO v_usage
  FROM public.student_credit_usages
  WHERE booking_id = p_booking_id
  FOR UPDATE;

  IF v_usage IS NULL THEN
    RETURN;
  END IF;

  IF v_usage.restored_at IS NOT NULL THEN
    RETURN;
  END IF;

  UPDATE public.student_plan_selections
  SET remaining_credits = GREATEST(remaining_credits, 0) + v_usage.credits_used,
      updated_at = now()
  WHERE id = v_usage.selection_id;

  UPDATE public.student_credit_usages
  SET restored_at = now()
  WHERE id = v_usage.id;

  PERFORM public.sync_student_month_credit_snapshot(v_usage.student_id);
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
      lp.class_type,
      ROW_NUMBER() OVER (
        PARTITION BY lp.class_type
        ORDER BY sps.selected_at DESC, sps.updated_at DESC, sps.id DESC
      ) AS rn
    FROM public.student_plan_selections sps
    JOIN public.lesson_plans lp ON lp.id = sps.plan_id
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

-- New 3-arg version with partner_name support.
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
BEGIN
  IF p_seats_reserved NOT IN (1, 2) THEN
    RAISE EXCEPTION 'seats_reserved deve ser 1 ou 2';
  END IF;

  v_partner_name := NULLIF(BTRIM(COALESCE(p_partner_name, '')), '');

  IF p_seats_reserved = 2 AND v_partner_name IS NULL THEN
    RAISE EXCEPTION 'Informe o nome da segunda pessoa para agendar aula em dupla.';
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

-- Keep backward compatibility with existing clients calling the 2-arg RPC.
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

-- Refresh snapshot balances for all students after logic changes.
DO $$
DECLARE
  v_profile RECORD;
BEGIN
  FOR v_profile IN
    SELECT p.id
    FROM public.profiles p
    WHERE p.role = 'student'
  LOOP
    PERFORM public.sync_student_month_credit_snapshot(v_profile.id);
  END LOOP;
END;
$$;
