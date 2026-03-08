-- Notification automations:
-- 1) Password changed
-- 2) Profile data updated
-- 3) Credits purchase/update (plan selection)
-- 4) Credits expiring in 3 days

-- ============================================
-- 1) Password changed notification
-- ============================================
CREATE OR REPLACE FUNCTION public.notify_password_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = NEW.id) THEN
    INSERT INTO public.notifications (user_id, type, title, message)
    VALUES (
      NEW.id,
      'password_updated',
      'Senha atualizada',
      'Sua senha foi redefinida com sucesso.'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_password_updated ON auth.users;
CREATE TRIGGER on_auth_user_password_updated
  AFTER UPDATE OF encrypted_password ON auth.users
  FOR EACH ROW
  WHEN (OLD.encrypted_password IS DISTINCT FROM NEW.encrypted_password)
  EXECUTE FUNCTION public.notify_password_changed();

-- ============================================
-- 2) Profile data updated notification
-- ============================================
CREATE OR REPLACE FUNCTION public.notify_profile_updated()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed_fields TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF NEW.first_name IS DISTINCT FROM OLD.first_name OR NEW.last_name IS DISTINCT FROM OLD.last_name OR NEW.full_name IS DISTINCT FROM OLD.full_name THEN
    v_changed_fields := array_append(v_changed_fields, 'nome');
  END IF;

  IF NEW.phone IS DISTINCT FROM OLD.phone THEN
    v_changed_fields := array_append(v_changed_fields, 'telefone');
  END IF;

  IF NEW.avatar_url IS DISTINCT FROM OLD.avatar_url THEN
    v_changed_fields := array_append(v_changed_fields, 'foto de perfil');
  END IF;

  IF COALESCE(array_length(v_changed_fields, 1), 0) = 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, message)
  VALUES (
    NEW.id,
    'profile_updated',
    'Dados atualizados',
    'Seus dados foram atualizados: ' || array_to_string(v_changed_fields, ', ') || '.'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_updated_notify ON public.profiles;
CREATE TRIGGER on_profile_updated_notify
  AFTER UPDATE OF full_name, first_name, last_name, phone, avatar_url ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_profile_updated();

-- ============================================
-- 3) Credits purchase/update notification
-- ============================================
CREATE OR REPLACE FUNCTION public.notify_plan_selection_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_name TEXT;
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.plan_id IS NOT DISTINCT FROM OLD.plan_id
      AND NEW.credits IS NOT DISTINCT FROM OLD.credits
      AND NEW.price_cents IS NOT DISTINCT FROM OLD.price_cents
      AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT lp.name
  INTO v_plan_name
  FROM public.lesson_plans lp
  WHERE lp.id = NEW.plan_id;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.notifications (user_id, type, title, message)
    VALUES (
      NEW.student_id,
      'credits_purchased',
      'Compra de creditos confirmada',
      format(
        'Compra confirmada: %s (%s creditos) para %s.',
        COALESCE(v_plan_name, 'Plano'),
        NEW.credits,
        to_char(NEW.month_ref, 'MM/YYYY')
      )
    );
  ELSE
    INSERT INTO public.notifications (user_id, type, title, message)
    VALUES (
      NEW.student_id,
      'credits_updated',
      'Creditos atualizados',
      format(
        'Seus creditos foram atualizados para %s (%s creditos) no mes %s.',
        COALESCE(v_plan_name, 'Plano'),
        NEW.credits,
        to_char(NEW.month_ref, 'MM/YYYY')
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_student_plan_selection_notify ON public.student_plan_selections;
CREATE TRIGGER on_student_plan_selection_notify
  AFTER INSERT OR UPDATE ON public.student_plan_selections
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_plan_selection_changed();

-- ============================================
-- 4) Credits expiring in 3 days notification
-- ============================================
CREATE OR REPLACE FUNCTION public.notify_due_credit_expiry(p_user_id UUID DEFAULT NULL)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_selection RECORD;
  v_validity_days INT;
  v_expiration_date DATE;
  v_today_br DATE;
  v_days_remaining INT;
  v_message TEXT;
BEGIN
  v_user_id := COALESCE(p_user_id, auth.uid());

  IF v_user_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT s.id, s.student_id, s.month_ref, s.credits, s.selected_at
  INTO v_selection
  FROM public.student_plan_selections s
  WHERE s.student_id = v_user_id
    AND s.status = 'active'
  ORDER BY s.selected_at DESC
  LIMIT 1;

  IF v_selection IS NULL THEN
    RETURN 0;
  END IF;

  v_validity_days := CASE
    WHEN v_selection.credits = 1 THEN 15
    WHEN v_selection.credits >= 10 THEN 45
    ELSE 30
  END;

  v_expiration_date := ((v_selection.selected_at AT TIME ZONE 'America/Sao_Paulo')::date + v_validity_days);
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

CREATE OR REPLACE FUNCTION public.notify_due_credit_expiry_all()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total INT := 0;
  v_student RECORD;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  FOR v_student IN
    SELECT p.id
    FROM public.profiles p
    WHERE p.role = 'student'
  LOOP
    v_total := v_total + public.notify_due_credit_expiry(v_student.id);
  END LOOP;

  RETURN v_total;
END;
$$;
