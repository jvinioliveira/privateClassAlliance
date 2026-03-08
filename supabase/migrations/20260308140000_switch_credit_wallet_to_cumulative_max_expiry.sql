-- Switch credit behavior to a cumulative wallet with max-expiry renewal.
-- Rule:
-- - each purchase adds credits to the current balance
-- - expiration becomes the greatest between current expiration and new purchase validity
-- - consumption/cancellation update the current wallet balance

ALTER TABLE public.student_plan_selections
DROP CONSTRAINT IF EXISTS student_plan_selections_remaining_credits_check;

ALTER TABLE public.student_plan_selections
ADD CONSTRAINT student_plan_selections_remaining_credits_check
CHECK (remaining_credits >= 0);

-- Consolidate current balance into each student's latest active selection row.
WITH per_student AS (
  SELECT
    s.student_id,
    (ARRAY_AGG(s.id ORDER BY s.selected_at DESC, s.updated_at DESC, s.id DESC))[1] AS latest_id,
    COALESCE(
      SUM(
        CASE
          WHEN s.status = 'active' AND s.expires_at > now() THEN GREATEST(s.remaining_credits, 0)
          ELSE 0
        END
      ),
      0
    )::INT AS total_remaining,
    MAX(CASE WHEN s.status = 'active' THEN s.expires_at END) AS max_expiration
  FROM public.student_plan_selections s
  GROUP BY s.student_id
)
UPDATE public.student_plan_selections s
SET
  remaining_credits = ps.total_remaining,
  expires_at = COALESCE(ps.max_expiration, s.expires_at),
  updated_at = now()
FROM per_student ps
WHERE s.id = ps.latest_id;

CREATE OR REPLACE FUNCTION public.get_student_available_credits(p_student_id UUID DEFAULT auth.uid())
RETURNS INT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_selection public.student_plan_selections%ROWTYPE;
BEGIN
  IF p_student_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT sps.*
  INTO v_selection
  FROM public.student_plan_selections sps
  WHERE sps.student_id = p_student_id
    AND sps.status = 'active'
  ORDER BY sps.selected_at DESC, sps.updated_at DESC, sps.id DESC
  LIMIT 1;

  IF v_selection IS NULL THEN
    RETURN 0;
  END IF;

  IF v_selection.expires_at <= now() THEN
    RETURN 0;
  END IF;

  RETURN GREATEST(COALESCE(v_selection.remaining_credits, 0), 0);
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
  WHERE sps.student_id = auth.uid()
    AND sps.status = 'active'
  ORDER BY sps.selected_at DESC, sps.updated_at DESC, sps.id DESC
  LIMIT 1
  FOR UPDATE;

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
BEGIN
  IF p_student_id IS NULL THEN
    RAISE EXCEPTION 'Aluno invalido';
  END IF;

  IF p_booking_id IS NULL THEN
    RAISE EXCEPTION 'Agendamento invalido';
  END IF;

  SELECT sps.*
  INTO v_wallet
  FROM public.student_plan_selections sps
  WHERE sps.student_id = p_student_id
    AND sps.status = 'active'
  ORDER BY sps.selected_at DESC, sps.updated_at DESC, sps.id DESC
  LIMIT 1
  FOR UPDATE;

  IF v_wallet IS NULL THEN
    RAISE EXCEPTION 'Sem creditos disponiveis. Compre um novo plano para agendar.';
  END IF;

  IF v_wallet.expires_at <= now() THEN
    RAISE EXCEPTION 'Seus creditos expiraram. Compre um novo plano para continuar.';
  END IF;

  IF COALESCE(v_wallet.remaining_credits, 0) <= 0 THEN
    RAISE EXCEPTION 'Sem creditos disponiveis. Compre um novo plano para agendar.';
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
  v_wallet public.student_plan_selections%ROWTYPE;
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

  SELECT sps.*
  INTO v_wallet
  FROM public.student_plan_selections sps
  WHERE sps.student_id = v_usage.student_id
    AND sps.status = 'active'
  ORDER BY sps.selected_at DESC, sps.updated_at DESC, sps.id DESC
  LIMIT 1
  FOR UPDATE;

  IF v_wallet IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.student_plan_selections
  SET remaining_credits = GREATEST(remaining_credits, 0) + v_usage.credits_used,
      updated_at = now()
  WHERE id = v_wallet.id;

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

  SELECT s.id, s.student_id, s.expires_at, s.remaining_credits
  INTO v_selection
  FROM public.student_plan_selections s
  WHERE s.student_id = v_user_id
    AND s.status = 'active'
  ORDER BY s.selected_at DESC, s.updated_at DESC, s.id DESC
  LIMIT 1;

  IF v_selection IS NULL THEN
    RETURN 0;
  END IF;

  IF v_selection.expires_at <= now() OR COALESCE(v_selection.remaining_credits, 0) <= 0 THEN
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

-- Refresh snapshot balances for all students.
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
