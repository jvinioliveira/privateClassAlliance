-- Accumulated credits by purchase package (30-day validity each purchase).
-- This migration keeps existing tables but changes credit consumption logic:
-- - each purchase creates a new package record
-- - credits are consumed from the package that expires first
-- - cancellations restore consumed credit

ALTER TABLE public.student_plan_selections
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

ALTER TABLE public.student_plan_selections
ADD COLUMN IF NOT EXISTS remaining_credits INT;

UPDATE public.student_plan_selections
SET expires_at = selected_at + INTERVAL '30 days'
WHERE expires_at IS NULL;

WITH used_by_month AS (
  SELECT
    b.student_id,
    public.get_month_ref(s.start_time) AS month_ref,
    COUNT(*)::INT AS used_count
  FROM public.bookings b
  JOIN public.availability_slots s ON s.id = b.slot_id
  WHERE b.status = 'booked'
  GROUP BY b.student_id, public.get_month_ref(s.start_time)
)
UPDATE public.student_plan_selections sps
SET remaining_credits = GREATEST(sps.credits - COALESCE(ubm.used_count, 0), 0)
FROM used_by_month ubm
WHERE sps.remaining_credits IS NULL
  AND sps.student_id = ubm.student_id
  AND sps.month_ref = ubm.month_ref;

UPDATE public.student_plan_selections
SET remaining_credits = credits
WHERE remaining_credits IS NULL;

ALTER TABLE public.student_plan_selections
ALTER COLUMN expires_at SET NOT NULL;

ALTER TABLE public.student_plan_selections
ALTER COLUMN remaining_credits SET NOT NULL;

ALTER TABLE public.student_plan_selections
DROP CONSTRAINT IF EXISTS student_plan_selections_remaining_credits_check;

-- Normalize legacy data before enforcing the new bounds check.
UPDATE public.student_plan_selections
SET remaining_credits = LEAST(GREATEST(remaining_credits, 0), credits)
WHERE remaining_credits < 0
   OR remaining_credits > credits;

ALTER TABLE public.student_plan_selections
ADD CONSTRAINT student_plan_selections_remaining_credits_check
CHECK (remaining_credits >= 0 AND remaining_credits <= credits);

ALTER TABLE public.student_plan_selections
DROP CONSTRAINT IF EXISTS student_plan_selections_student_id_month_ref_key;

CREATE INDEX IF NOT EXISTS idx_student_plan_selections_student_status_expiration
ON public.student_plan_selections (student_id, status, expires_at, selected_at);

CREATE TABLE IF NOT EXISTS public.student_credit_usages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL UNIQUE REFERENCES public.bookings(id) ON DELETE CASCADE,
  selection_id UUID NOT NULL REFERENCES public.student_plan_selections(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  credits_used INT NOT NULL DEFAULT 1 CHECK (credits_used > 0),
  consumed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  restored_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_student_credit_usages_student
ON public.student_credit_usages (student_id, consumed_at DESC);

CREATE INDEX IF NOT EXISTS idx_student_credit_usages_selection
ON public.student_credit_usages (selection_id);

ALTER TABLE public.student_credit_usages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students can view own credit usages" ON public.student_credit_usages;
CREATE POLICY "Students can view own credit usages"
  ON public.student_credit_usages FOR SELECT
  USING (auth.uid() = student_id);

DROP POLICY IF EXISTS "Admins can manage all credit usages" ON public.student_credit_usages;
CREATE POLICY "Admins can manage all credit usages"
  ON public.student_credit_usages FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

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

  SELECT COALESCE(SUM(sps.remaining_credits), 0)::INT
  INTO v_available
  FROM public.student_plan_selections sps
  WHERE sps.student_id = p_student_id
    AND sps.status = 'active'
    AND sps.expires_at > now()
    AND sps.remaining_credits > 0;

  RETURN COALESCE(v_available, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_student_month_credit_snapshot(p_student_id UUID DEFAULT auth.uid())
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month_ref DATE := public.get_month_ref(now());
  v_available INT := public.get_student_available_credits(p_student_id);
BEGIN
  IF p_student_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.student_month_credits (student_id, month_ref, monthly_limit)
  VALUES (p_student_id, v_month_ref, v_available)
  ON CONFLICT (student_id, month_ref)
  DO UPDATE SET
    monthly_limit = EXCLUDED.monthly_limit,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_credit_for_booking(p_student_id UUID, p_booking_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_selection public.student_plan_selections%ROWTYPE;
BEGIN
  IF p_student_id IS NULL THEN
    RAISE EXCEPTION 'Aluno invalido';
  END IF;

  IF p_booking_id IS NULL THEN
    RAISE EXCEPTION 'Agendamento invalido';
  END IF;

  SELECT sps.*
  INTO v_selection
  FROM public.student_plan_selections sps
  WHERE sps.student_id = p_student_id
    AND sps.status = 'active'
    AND sps.expires_at > now()
    AND sps.remaining_credits > 0
  ORDER BY sps.expires_at ASC, sps.selected_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_selection IS NULL THEN
    RAISE EXCEPTION 'Sem creditos disponiveis. Compre um novo plano para agendar.';
  END IF;

  UPDATE public.student_plan_selections
  SET remaining_credits = remaining_credits - 1,
      updated_at = now()
  WHERE id = v_selection.id;

  INSERT INTO public.student_credit_usages (
    booking_id,
    selection_id,
    student_id,
    credits_used
  )
  VALUES (
    p_booking_id,
    v_selection.id,
    p_student_id,
    1
  );

  PERFORM public.sync_student_month_credit_snapshot(p_student_id);

  RETURN v_selection.id;
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
  SET remaining_credits = LEAST(credits, remaining_credits + v_usage.credits_used),
      updated_at = now()
  WHERE id = v_usage.selection_id;

  UPDATE public.student_credit_usages
  SET restored_at = now()
  WHERE id = v_usage.id;

  PERFORM public.sync_student_month_credit_snapshot(v_usage.student_id);
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
  v_selection_id UUID;
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
    v_plan.credits,
    v_plan.price_cents,
    'active',
    now(),
    now() + INTERVAL '30 days',
    now()
  )
  RETURNING id INTO v_selection_id;

  PERFORM public.sync_student_month_credit_snapshot(auth.uid());

  RETURN v_selection_id;
END;
$$;

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

  PERFORM public.consume_credit_for_booking(auth.uid(), v_booking_id);

  INSERT INTO bookings (id, slot_id, student_id, seats_reserved, created_by_admin)
  VALUES (v_booking_id, p_slot_id, auth.uid(), p_seats_reserved, false);

  INSERT INTO notifications (user_id, type, title, message)
  VALUES (auth.uid(), 'booking_confirmed', 'Agendamento confirmado',
    'Sua aula foi agendada para ' || to_char(v_slot.start_time AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI'));

  RETURN v_booking_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_booking(p_booking_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking bookings%ROWTYPE;
  v_slot availability_slots%ROWTYPE;
BEGIN
  SELECT * INTO v_booking FROM bookings WHERE id = p_booking_id;
  IF v_booking IS NULL THEN
    RAISE EXCEPTION 'Agendamento nao encontrado';
  END IF;

  IF v_booking.student_id != auth.uid() AND NOT is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissao';
  END IF;

  IF v_booking.status != 'booked' THEN
    RAISE EXCEPTION 'Apenas agendamentos ativos podem ser cancelados';
  END IF;

  IF NOT is_admin(auth.uid()) THEN
    SELECT * INTO v_slot FROM availability_slots WHERE id = v_booking.slot_id;
    IF now() > (v_slot.start_time - INTERVAL '24 hours') THEN
      RAISE EXCEPTION 'Cancelamento deve ser feito com pelo menos 24h de antecedencia';
    END IF;
  END IF;

  UPDATE bookings
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_booking_id;

  PERFORM public.restore_credit_for_booking(p_booking_id);

  INSERT INTO notifications (user_id, type, title, message)
  VALUES (v_booking.student_id, 'booking_cancelled', 'Aula cancelada',
    'Seu agendamento foi cancelado.');

  PERFORM process_waitlist(v_booking.slot_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.reschedule_booking(p_booking_id UUID, p_new_slot_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking bookings%ROWTYPE;
  v_old_slot availability_slots%ROWTYPE;
  v_new_slot availability_slots%ROWTYPE;
  v_booked_seats INT;
BEGIN
  SELECT * INTO v_booking FROM bookings WHERE id = p_booking_id;
  IF v_booking IS NULL THEN RAISE EXCEPTION 'Agendamento nao encontrado'; END IF;

  IF v_booking.student_id != auth.uid() AND NOT is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissao';
  END IF;

  SELECT * INTO v_old_slot FROM availability_slots WHERE id = v_booking.slot_id;
  SELECT * INTO v_new_slot FROM availability_slots WHERE id = p_new_slot_id FOR UPDATE;

  IF v_new_slot IS NULL OR v_new_slot.status != 'available' THEN
    RAISE EXCEPTION 'Novo horario nao disponivel';
  END IF;

  IF NOT is_admin(auth.uid()) THEN
    IF now() > (v_old_slot.start_time - INTERVAL '24 hours') THEN
      RAISE EXCEPTION 'Remarcacao deve ser feita com pelo menos 24h de antecedencia';
    END IF;
  END IF;

  SELECT COALESCE(SUM(seats_reserved), 0) INTO v_booked_seats
  FROM bookings WHERE slot_id = p_new_slot_id AND status = 'booked';

  IF (v_new_slot.capacity - v_booked_seats) < v_booking.seats_reserved THEN
    RAISE EXCEPTION 'Novo horario sem vagas suficientes';
  END IF;

  UPDATE bookings SET slot_id = p_new_slot_id, updated_at = now() WHERE id = p_booking_id;

  INSERT INTO notifications (user_id, type, title, message)
  VALUES (v_booking.student_id, 'booking_rescheduled', 'Aula remarcada',
    'Sua aula foi remarcada para ' || to_char(v_new_slot.start_time AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI'));

  PERFORM process_waitlist(v_booking.slot_id);
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
      PERFORM public.consume_credit_for_booking(p_student_id, v_booking_id);

      INSERT INTO bookings (id, slot_id, student_id, seats_reserved, created_by_admin)
      VALUES (v_booking_id, v_slot_id, p_student_id, p_seats_reserved_default, true);

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

  SELECT s.id, s.student_id, s.expires_at
  INTO v_selection
  FROM public.student_plan_selections s
  WHERE s.student_id = v_user_id
    AND s.status = 'active'
    AND s.expires_at > now()
    AND s.remaining_credits > 0
  ORDER BY s.expires_at ASC
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

  v_message := format('Seus creditos expiram em 3 dias (%s).', to_char(v_expiration_date, 'DD/MM/YYYY'));

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
