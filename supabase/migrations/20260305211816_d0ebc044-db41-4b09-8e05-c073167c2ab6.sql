
-- ============================================
-- 1. PROFILES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    'student'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Helper: check if user is admin (avoids recursive RLS)
CREATE OR REPLACE FUNCTION public.is_admin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _user_id AND role = 'admin'
  );
$$;

-- ============================================
-- 2. AVAILABILITY_SLOTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.availability_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  capacity INT NOT NULL DEFAULT 2,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'blocked')),
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_slots_start_time ON public.availability_slots(start_time);
CREATE INDEX IF NOT EXISTS idx_slots_status ON public.availability_slots(status);

ALTER TABLE public.availability_slots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students can view available slots" ON public.availability_slots;
CREATE POLICY "Students can view available slots"
  ON public.availability_slots FOR SELECT
  USING (status = 'available' OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can manage slots" ON public.availability_slots;
CREATE POLICY "Admins can manage slots"
  ON public.availability_slots FOR ALL
  USING (public.is_admin(auth.uid()));

-- ============================================
-- 3. BOOKINGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id UUID NOT NULL REFERENCES public.availability_slots(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'cancelled', 'completed', 'no_show')),
  seats_reserved INT NOT NULL CHECK (seats_reserved IN (1, 2)),
  created_by_admin BOOLEAN NOT NULL DEFAULT false,
  attendance_status TEXT NOT NULL DEFAULT 'pending' CHECK (attendance_status IN ('pending', 'present', 'absent')),
  checked_in_at TIMESTAMPTZ,
  checked_in_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(slot_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_bookings_slot_id ON public.bookings(slot_id);
CREATE INDEX IF NOT EXISTS idx_bookings_student_id ON public.bookings(student_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON public.bookings(status);

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students can view own bookings" ON public.bookings;
CREATE POLICY "Students can view own bookings"
  ON public.bookings FOR SELECT
  USING (auth.uid() = student_id);

DROP POLICY IF EXISTS "Admins can manage all bookings" ON public.bookings;
CREATE POLICY "Admins can manage all bookings"
  ON public.bookings FOR ALL
  USING (public.is_admin(auth.uid()));

-- ============================================
-- 4. STUDENT_MONTH_CREDITS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.student_month_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  month_ref DATE NOT NULL,
  monthly_limit INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(student_id, month_ref)
);

ALTER TABLE public.student_month_credits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students can view own credits" ON public.student_month_credits;
CREATE POLICY "Students can view own credits"
  ON public.student_month_credits FOR SELECT
  USING (auth.uid() = student_id);

DROP POLICY IF EXISTS "Admins can manage all credits" ON public.student_month_credits;
CREATE POLICY "Admins can manage all credits"
  ON public.student_month_credits FOR ALL
  USING (public.is_admin(auth.uid()));

-- ============================================
-- 5. WAITLIST TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id UUID NOT NULL REFERENCES public.availability_slots(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'notified', 'accepted', 'expired', 'cancelled')),
  position INT NOT NULL,
  notified_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(slot_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_waitlist_slot_status ON public.waitlist(slot_id, status);
CREATE INDEX IF NOT EXISTS idx_waitlist_slot_position ON public.waitlist(slot_id, position);

ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students can view own waitlist" ON public.waitlist;
CREATE POLICY "Students can view own waitlist"
  ON public.waitlist FOR SELECT
  USING (auth.uid() = student_id);

DROP POLICY IF EXISTS "Admins can manage all waitlist" ON public.waitlist;
CREATE POLICY "Admins can manage all waitlist"
  ON public.waitlist FOR ALL
  USING (public.is_admin(auth.uid()));

-- ============================================
-- 6. NOTIFICATIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type TEXT,
  title TEXT,
  message TEXT,
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
CREATE POLICY "Users can view own notifications"
  ON public.notifications FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
CREATE POLICY "Users can update own notifications"
  ON public.notifications FOR UPDATE
  USING (auth.uid() = user_id);

-- ============================================
-- 7. HELPER FUNCTION: get_month_ref
-- ============================================
CREATE OR REPLACE FUNCTION public.get_month_ref(ts TIMESTAMPTZ)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT date_trunc('month', ts AT TIME ZONE 'America/Sao_Paulo')::date;
$$;

-- ============================================
-- 8. RPC: book_slot
-- ============================================
CREATE OR REPLACE FUNCTION public.book_slot(p_slot_id UUID, p_seats_reserved INT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slot availability_slots%ROWTYPE;
  v_booked_seats INT;
  v_month_ref DATE;
  v_monthly_limit INT;
  v_used INT;
  v_booking_id UUID;
BEGIN
  -- Validate seats
  IF p_seats_reserved NOT IN (1, 2) THEN
    RAISE EXCEPTION 'seats_reserved deve ser 1 ou 2';
  END IF;

  -- Lock and get slot
  SELECT * INTO v_slot FROM availability_slots WHERE id = p_slot_id FOR UPDATE;
  IF v_slot IS NULL THEN
    RAISE EXCEPTION 'Horário não encontrado';
  END IF;
  IF v_slot.status != 'available' THEN
    RAISE EXCEPTION 'Horário não está disponível';
  END IF;

  -- Check capacity
  SELECT COALESCE(SUM(seats_reserved), 0) INTO v_booked_seats
  FROM bookings WHERE slot_id = p_slot_id AND status = 'booked';

  IF (v_slot.capacity - v_booked_seats) < p_seats_reserved THEN
    RAISE EXCEPTION 'Vagas insuficientes';
  END IF;

  -- Check credits
  v_month_ref := get_month_ref(v_slot.start_time);

  SELECT monthly_limit INTO v_monthly_limit
  FROM student_month_credits
  WHERE student_id = auth.uid() AND month_ref = v_month_ref;

  IF v_monthly_limit IS NULL THEN
    v_monthly_limit := 0;
  END IF;

  SELECT COUNT(*) INTO v_used
  FROM bookings b
  JOIN availability_slots s ON b.slot_id = s.id
  WHERE b.student_id = auth.uid()
    AND b.status = 'booked'
    AND get_month_ref(s.start_time) = v_month_ref;

  IF v_used >= v_monthly_limit THEN
    RAISE EXCEPTION 'Créditos mensais esgotados (usado: %, limite: %)', v_used, v_monthly_limit;
  END IF;

  -- Create booking
  INSERT INTO bookings (slot_id, student_id, seats_reserved, created_by_admin)
  VALUES (p_slot_id, auth.uid(), p_seats_reserved, false)
  RETURNING id INTO v_booking_id;

  -- Notification
  INSERT INTO notifications (user_id, type, title, message)
  VALUES (auth.uid(), 'booking_confirmed', 'Agendamento confirmado',
    'Sua aula foi agendada para ' || to_char(v_slot.start_time AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI'));

  RETURN v_booking_id;
END;
$$;

-- ============================================
-- 9. RPC: cancel_booking
-- ============================================
DROP FUNCTION IF EXISTS public.cancel_booking(UUID);

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
    RAISE EXCEPTION 'Agendamento não encontrado';
  END IF;

  -- Check ownership or admin
  IF v_booking.student_id != auth.uid() AND NOT is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  -- Check 24h rule for students
  IF NOT is_admin(auth.uid()) THEN
    SELECT * INTO v_slot FROM availability_slots WHERE id = v_booking.slot_id;
    IF now() > (v_slot.start_time - INTERVAL '24 hours') THEN
      RAISE EXCEPTION 'Cancelamento deve ser feito com pelo menos 24h de antecedência';
    END IF;
  END IF;

  UPDATE bookings SET status = 'cancelled', updated_at = now() WHERE id = p_booking_id;

  -- Notification
  INSERT INTO notifications (user_id, type, title, message)
  VALUES (v_booking.student_id, 'booking_cancelled', 'Aula cancelada',
    'Seu agendamento foi cancelado.');

  -- Process waitlist
  PERFORM process_waitlist(v_booking.slot_id);
END;
$$;

-- ============================================
-- 10. RPC: process_waitlist
-- ============================================
CREATE OR REPLACE FUNCTION public.process_waitlist(p_slot_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slot availability_slots%ROWTYPE;
  v_booked_seats INT;
  v_free INT;
  v_waitlist_entry waitlist%ROWTYPE;
BEGIN
  SELECT * INTO v_slot FROM availability_slots WHERE id = p_slot_id;
  IF v_slot IS NULL THEN RETURN; END IF;

  SELECT COALESCE(SUM(seats_reserved), 0) INTO v_booked_seats
  FROM bookings WHERE slot_id = p_slot_id AND status = 'booked';

  v_free := v_slot.capacity - v_booked_seats;

  IF v_free >= 1 THEN
    SELECT * INTO v_waitlist_entry
    FROM waitlist
    WHERE slot_id = p_slot_id AND status = 'waiting'
    ORDER BY position ASC
    LIMIT 1;

    IF v_waitlist_entry IS NOT NULL THEN
      UPDATE waitlist
      SET status = 'notified',
          notified_at = now(),
          expires_at = now() + INTERVAL '30 minutes'
      WHERE id = v_waitlist_entry.id;

      INSERT INTO notifications (user_id, type, title, message)
      VALUES (v_waitlist_entry.student_id, 'waitlist_notified',
        'Vaga disponível!',
        'Uma vaga abriu. Você tem 30 minutos para confirmar.');
    END IF;
  END IF;
END;
$$;

-- ============================================
-- 11. RPC: reschedule_booking
-- ============================================
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
  v_old_month DATE;
  v_new_month DATE;
  v_monthly_limit INT;
  v_used INT;
BEGIN
  SELECT * INTO v_booking FROM bookings WHERE id = p_booking_id;
  IF v_booking IS NULL THEN RAISE EXCEPTION 'Agendamento não encontrado'; END IF;

  IF v_booking.student_id != auth.uid() AND NOT is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  SELECT * INTO v_old_slot FROM availability_slots WHERE id = v_booking.slot_id;
  SELECT * INTO v_new_slot FROM availability_slots WHERE id = p_new_slot_id FOR UPDATE;

  IF v_new_slot IS NULL OR v_new_slot.status != 'available' THEN
    RAISE EXCEPTION 'Novo horário não disponível';
  END IF;

  -- 24h rule for students
  IF NOT is_admin(auth.uid()) THEN
    IF now() > (v_old_slot.start_time - INTERVAL '24 hours') THEN
      RAISE EXCEPTION 'Remarcação deve ser feita com pelo menos 24h de antecedência';
    END IF;
  END IF;

  -- Check capacity of new slot
  SELECT COALESCE(SUM(seats_reserved), 0) INTO v_booked_seats
  FROM bookings WHERE slot_id = p_new_slot_id AND status = 'booked';

  IF (v_new_slot.capacity - v_booked_seats) < v_booking.seats_reserved THEN
    RAISE EXCEPTION 'Novo horário sem vagas suficientes';
  END IF;

  -- If month changed, revalidate credits
  v_old_month := get_month_ref(v_old_slot.start_time);
  v_new_month := get_month_ref(v_new_slot.start_time);

  IF v_old_month != v_new_month THEN
    SELECT COALESCE(monthly_limit, 0) INTO v_monthly_limit
    FROM student_month_credits
    WHERE student_id = v_booking.student_id AND month_ref = v_new_month;

    IF v_monthly_limit IS NULL THEN v_monthly_limit := 0; END IF;

    SELECT COUNT(*) INTO v_used
    FROM bookings b
    JOIN availability_slots s ON b.slot_id = s.id
    WHERE b.student_id = v_booking.student_id
      AND b.status = 'booked'
      AND get_month_ref(s.start_time) = v_new_month;

    IF v_used >= v_monthly_limit THEN
      RAISE EXCEPTION 'Sem créditos no mês de destino';
    END IF;
  END IF;

  UPDATE bookings SET slot_id = p_new_slot_id, updated_at = now() WHERE id = p_booking_id;

  INSERT INTO notifications (user_id, type, title, message)
  VALUES (v_booking.student_id, 'booking_rescheduled', 'Aula remarcada',
    'Sua aula foi remarcada para ' || to_char(v_new_slot.start_time AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI'));

  PERFORM process_waitlist(v_booking.slot_id);
END;
$$;

-- ============================================
-- 12. RPC: waitlist_join
-- ============================================
CREATE OR REPLACE FUNCTION public.waitlist_join(p_slot_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_pos INT;
  v_id UUID;
BEGIN
  SELECT COALESCE(MAX(position), 0) INTO v_max_pos
  FROM waitlist WHERE slot_id = p_slot_id;

  INSERT INTO waitlist (slot_id, student_id, position)
  VALUES (p_slot_id, auth.uid(), v_max_pos + 1)
  RETURNING id INTO v_id;

  INSERT INTO notifications (user_id, type, title, message)
  VALUES (auth.uid(), 'waitlist_joined', 'Lista de espera',
    'Você está na posição ' || (v_max_pos + 1) || ' da lista de espera.');

  RETURN v_id;
END;
$$;

-- ============================================
-- 13. RPC: waitlist_accept
-- ============================================
CREATE OR REPLACE FUNCTION public.waitlist_accept(p_waitlist_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry waitlist%ROWTYPE;
  v_booking_id UUID;
BEGIN
  SELECT * INTO v_entry FROM waitlist WHERE id = p_waitlist_id;
  IF v_entry IS NULL THEN RAISE EXCEPTION 'Entrada na lista não encontrada'; END IF;
  IF v_entry.status != 'notified' THEN RAISE EXCEPTION 'Entrada não está como notificada'; END IF;
  IF now() > v_entry.expires_at THEN
    UPDATE waitlist SET status = 'expired' WHERE id = p_waitlist_id;
    PERFORM process_waitlist(v_entry.slot_id);
    RAISE EXCEPTION 'Tempo expirado para aceitar';
  END IF;

  BEGIN
    v_booking_id := book_slot(v_entry.slot_id, 1);
    UPDATE waitlist SET status = 'accepted' WHERE id = p_waitlist_id;
    RETURN v_booking_id;
  EXCEPTION WHEN OTHERS THEN
    UPDATE waitlist SET status = 'expired' WHERE id = p_waitlist_id;
    PERFORM process_waitlist(v_entry.slot_id);
    RAISE;
  END;
END;
$$;

-- ============================================
-- 14. RPC: admin_bulk_book
-- ============================================
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
  v_month_ref DATE;
  v_monthly_limit INT;
  v_used INT;
  v_booking_id UUID;
BEGIN
  IF NOT is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Acesso negado: apenas admin';
  END IF;

  FOREACH v_slot_id IN ARRAY p_slot_ids LOOP
    BEGIN
      SELECT * INTO v_slot FROM availability_slots WHERE id = v_slot_id FOR UPDATE;
      IF v_slot IS NULL OR v_slot.status != 'available' THEN
        v_result := v_result || jsonb_build_object('slot_id', v_slot_id, 'success', false, 'error', 'Horário indisponível');
        CONTINUE;
      END IF;

      SELECT COALESCE(SUM(seats_reserved), 0) INTO v_booked_seats
      FROM bookings WHERE slot_id = v_slot_id AND status = 'booked';

      IF (v_slot.capacity - v_booked_seats) < p_seats_reserved_default THEN
        v_result := v_result || jsonb_build_object('slot_id', v_slot_id, 'success', false, 'error', 'Sem vagas');
        CONTINUE;
      END IF;

      v_month_ref := get_month_ref(v_slot.start_time);

      SELECT COALESCE(monthly_limit, 0) INTO v_monthly_limit
      FROM student_month_credits
      WHERE student_id = p_student_id AND month_ref = v_month_ref;

      IF v_monthly_limit IS NULL THEN v_monthly_limit := 0; END IF;

      SELECT COUNT(*) INTO v_used
      FROM bookings b
      JOIN availability_slots s ON b.slot_id = s.id
      WHERE b.student_id = p_student_id
        AND b.status = 'booked'
        AND get_month_ref(s.start_time) = v_month_ref;

      IF v_used >= v_monthly_limit THEN
        v_result := v_result || jsonb_build_object('slot_id', v_slot_id, 'success', false, 'error', 'Créditos esgotados');
        CONTINUE;
      END IF;

      INSERT INTO bookings (slot_id, student_id, seats_reserved, created_by_admin)
      VALUES (v_slot_id, p_student_id, p_seats_reserved_default, true)
      RETURNING id INTO v_booking_id;

      v_result := v_result || jsonb_build_object('slot_id', v_slot_id, 'success', true, 'booking_id', v_booking_id);

    EXCEPTION WHEN OTHERS THEN
      v_result := v_result || jsonb_build_object('slot_id', v_slot_id, 'success', false, 'error', SQLERRM);
    END;
  END LOOP;

  -- Notification
  INSERT INTO notifications (user_id, type, title, message)
  VALUES (p_student_id, 'bulk_booking', 'Aulas agendadas',
    'O professor agendou aulas para você.');

  RETURN v_result;
END;
$$;

-- ============================================
-- 15. RPC: admin_check_in
-- ============================================
CREATE OR REPLACE FUNCTION public.admin_check_in(p_booking_id UUID, p_attendance_status TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking bookings%ROWTYPE;
BEGIN
  IF NOT is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  SELECT * INTO v_booking FROM bookings WHERE id = p_booking_id;
  IF v_booking IS NULL THEN RAISE EXCEPTION 'Agendamento não encontrado'; END IF;
  IF v_booking.status = 'cancelled' THEN RAISE EXCEPTION 'Agendamento cancelado'; END IF;

  IF p_attendance_status = 'present' THEN
    UPDATE bookings
    SET attendance_status = 'present',
        checked_in_at = now(),
        checked_in_by = auth.uid(),
        status = 'completed',
        updated_at = now()
    WHERE id = p_booking_id;
  ELSIF p_attendance_status = 'absent' THEN
    UPDATE bookings
    SET attendance_status = 'absent',
        checked_in_at = now(),
        checked_in_by = auth.uid(),
        status = 'no_show',
        updated_at = now()
    WHERE id = p_booking_id;
  ELSE
    RAISE EXCEPTION 'Status inválido: use present ou absent';
  END IF;
END;
$$;

-- ============================================
-- 16. RPC: get_month_report
-- ============================================
CREATE OR REPLACE FUNCTION public.get_month_report(p_month_ref DATE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
  v_total_booked INT;
  v_total_completed INT;
  v_total_no_show INT;
  v_total_cancelled INT;
  v_total_capacity INT;
  v_total_seats INT;
BEGIN
  IF NOT is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  -- Count bookings by status for the month
  SELECT
    COUNT(*) FILTER (WHERE b.status IN ('booked','completed','no_show')),
    COUNT(*) FILTER (WHERE b.status = 'completed'),
    COUNT(*) FILTER (WHERE b.status = 'no_show'),
    COUNT(*) FILTER (WHERE b.status = 'cancelled')
  INTO v_total_booked, v_total_completed, v_total_no_show, v_total_cancelled
  FROM bookings b
  JOIN availability_slots s ON b.slot_id = s.id
  WHERE get_month_ref(s.start_time) = p_month_ref;

  -- Occupation rate
  SELECT COALESCE(SUM(capacity), 0) INTO v_total_capacity
  FROM availability_slots
  WHERE get_month_ref(start_time) = p_month_ref AND status = 'available';

  SELECT COALESCE(SUM(seats_reserved), 0) INTO v_total_seats
  FROM bookings b
  JOIN availability_slots s ON b.slot_id = s.id
  WHERE get_month_ref(s.start_time) = p_month_ref AND b.status IN ('booked','completed');

  v_result := jsonb_build_object(
    'total_booked', v_total_booked,
    'total_completed', v_total_completed,
    'total_no_show', v_total_no_show,
    'total_cancelled', v_total_cancelled,
    'total_capacity', v_total_capacity,
    'total_seats_used', v_total_seats,
    'occupation_rate', CASE WHEN v_total_capacity > 0
      THEN ROUND((v_total_seats::NUMERIC / v_total_capacity) * 100, 1)
      ELSE 0 END
  );

  RETURN v_result;
END;
$$;

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_bookings_updated_at ON public.bookings;
CREATE TRIGGER update_bookings_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_student_month_credits_updated_at ON public.student_month_credits;
CREATE TRIGGER update_student_month_credits_updated_at
  BEFORE UPDATE ON public.student_month_credits
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
