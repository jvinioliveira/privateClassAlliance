-- Chat-like messaging between students and admins (professor), plus student feedback form.

CREATE TABLE IF NOT EXISTS public.direct_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  message TEXT NOT NULL CHECK (char_length(btrim(message)) > 0),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_direct_messages_sender_created
ON public.direct_messages (sender_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_direct_messages_recipient_read
ON public.direct_messages (recipient_id, read_at, created_at DESC);

ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own direct messages" ON public.direct_messages;
CREATE POLICY "Users can view own direct messages"
  ON public.direct_messages FOR SELECT
  USING (auth.uid() = sender_id OR auth.uid() = recipient_id OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Users can send direct messages by role" ON public.direct_messages;
CREATE POLICY "Users can send direct messages by role"
  ON public.direct_messages FOR INSERT
  WITH CHECK (
    auth.uid() = sender_id
    AND (
      (
        public.is_admin(auth.uid())
        AND EXISTS (
          SELECT 1
          FROM public.profiles p
          WHERE p.id = recipient_id
            AND p.role = 'student'
        )
      )
      OR (
        NOT public.is_admin(auth.uid())
        AND EXISTS (
          SELECT 1
          FROM public.profiles p
          WHERE p.id = recipient_id
            AND p.role = 'admin'
        )
      )
    )
  );

DROP POLICY IF EXISTS "Recipients can mark direct messages as read" ON public.direct_messages;
CREATE POLICY "Recipients can mark direct messages as read"
  ON public.direct_messages FOR UPDATE
  USING (auth.uid() = recipient_id OR public.is_admin(auth.uid()))
  WITH CHECK (auth.uid() = recipient_id OR public.is_admin(auth.uid()));

DROP TRIGGER IF EXISTS update_direct_messages_updated_at ON public.direct_messages;
CREATE TRIGGER update_direct_messages_updated_at
  BEFORE UPDATE ON public.direct_messages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.student_feedback_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('complaint', 'compliment', 'suggestion', 'other')),
  subject TEXT,
  message TEXT NOT NULL CHECK (char_length(btrim(message)) > 0),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_review', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_feedback_student_created
ON public.student_feedback_submissions (student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_student_feedback_status_created
ON public.student_feedback_submissions (status, created_at DESC);

ALTER TABLE public.student_feedback_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students can view own feedback" ON public.student_feedback_submissions;
CREATE POLICY "Students can view own feedback"
  ON public.student_feedback_submissions FOR SELECT
  USING (auth.uid() = student_id);

DROP POLICY IF EXISTS "Students can submit own feedback" ON public.student_feedback_submissions;
CREATE POLICY "Students can submit own feedback"
  ON public.student_feedback_submissions FOR INSERT
  WITH CHECK (auth.uid() = student_id);

DROP POLICY IF EXISTS "Admins can manage feedback" ON public.student_feedback_submissions;
CREATE POLICY "Admins can manage feedback"
  ON public.student_feedback_submissions FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

DROP TRIGGER IF EXISTS update_student_feedback_submissions_updated_at ON public.student_feedback_submissions;
CREATE TRIGGER update_student_feedback_submissions_updated_at
  BEFORE UPDATE ON public.student_feedback_submissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP POLICY IF EXISTS "Students can view admin profiles for messaging" ON public.profiles;
CREATE POLICY "Students can view admin profiles for messaging"
  ON public.profiles FOR SELECT
  USING (auth.uid() IS NOT NULL AND role = 'admin');

CREATE OR REPLACE FUNCTION public.send_message_to_admins(p_message TEXT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_message TEXT;
  v_admin RECORD;
  v_sender_name TEXT;
  v_count INT := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuario nao autenticado';
  END IF;

  IF public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Use send_message_to_student para mensagens do professor';
  END IF;

  v_message := NULLIF(BTRIM(COALESCE(p_message, '')), '');
  IF v_message IS NULL THEN
    RAISE EXCEPTION 'Mensagem vazia';
  END IF;

  SELECT COALESCE(NULLIF(BTRIM(full_name), ''), 'Aluno')
  INTO v_sender_name
  FROM public.profiles
  WHERE id = auth.uid();

  FOR v_admin IN
    SELECT p.id
    FROM public.profiles p
    WHERE p.role = 'admin'
  LOOP
    INSERT INTO public.direct_messages (sender_id, recipient_id, message)
    VALUES (auth.uid(), v_admin.id, v_message);

    INSERT INTO public.notifications (user_id, type, title, message)
    VALUES (
      v_admin.id,
      'student_message',
      'Nova mensagem de aluno',
      format('%s enviou uma nova mensagem.', v_sender_name)
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.send_message_to_student(
  p_student_id UUID,
  p_message TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_message TEXT;
  v_message_id UUID;
  v_sender_name TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuario nao autenticado';
  END IF;

  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Apenas admin pode enviar mensagem para aluno';
  END IF;

  IF p_student_id IS NULL THEN
    RAISE EXCEPTION 'Aluno invalido';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_student_id
      AND p.role = 'student'
  ) THEN
    RAISE EXCEPTION 'Aluno nao encontrado';
  END IF;

  v_message := NULLIF(BTRIM(COALESCE(p_message, '')), '');
  IF v_message IS NULL THEN
    RAISE EXCEPTION 'Mensagem vazia';
  END IF;

  SELECT COALESCE(NULLIF(BTRIM(full_name), ''), 'Professor')
  INTO v_sender_name
  FROM public.profiles
  WHERE id = auth.uid();

  INSERT INTO public.direct_messages (sender_id, recipient_id, message)
  VALUES (auth.uid(), p_student_id, v_message)
  RETURNING id INTO v_message_id;

  INSERT INTO public.notifications (user_id, type, title, message)
  VALUES (
    p_student_id,
    'coach_message',
    'Mensagem do professor',
    format('%s enviou uma mensagem para voce.', v_sender_name)
  );

  RETURN v_message_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_student_feedback(
  p_category TEXT,
  p_subject TEXT,
  p_message TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_category TEXT;
  v_subject TEXT;
  v_message TEXT;
  v_feedback_id UUID;
  v_admin RECORD;
  v_sender_name TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuario nao autenticado';
  END IF;

  IF public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Apenas alunos enviam feedback';
  END IF;

  v_category := lower(NULLIF(BTRIM(COALESCE(p_category, '')), ''));
  IF v_category IS NULL OR v_category NOT IN ('complaint', 'compliment', 'suggestion', 'other') THEN
    RAISE EXCEPTION 'Categoria invalida';
  END IF;

  v_subject := NULLIF(BTRIM(COALESCE(p_subject, '')), '');
  v_message := NULLIF(BTRIM(COALESCE(p_message, '')), '');

  IF v_message IS NULL THEN
    RAISE EXCEPTION 'Mensagem vazia';
  END IF;

  INSERT INTO public.student_feedback_submissions (student_id, category, subject, message)
  VALUES (auth.uid(), v_category, v_subject, v_message)
  RETURNING id INTO v_feedback_id;

  SELECT COALESCE(NULLIF(BTRIM(full_name), ''), 'Aluno')
  INTO v_sender_name
  FROM public.profiles
  WHERE id = auth.uid();

  FOR v_admin IN
    SELECT p.id
    FROM public.profiles p
    WHERE p.role = 'admin'
  LOOP
    INSERT INTO public.notifications (user_id, type, title, message)
    VALUES (
      v_admin.id,
      'student_feedback',
      'Novo feedback de aluno',
      format('%s enviou um feedback (%s).', v_sender_name, v_category)
    );
  END LOOP;

  RETURN v_feedback_id;
END;
$$;
