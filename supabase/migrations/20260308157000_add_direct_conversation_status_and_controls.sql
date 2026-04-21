-- Add persistent conversation status (open/closed) for direct chat
-- and wire message functions to respect this status.

CREATE TABLE IF NOT EXISTS public.direct_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  admin_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, admin_id),
  CHECK (student_id <> admin_id)
);

CREATE INDEX IF NOT EXISTS idx_direct_conversations_student_status
ON public.direct_conversations (student_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_direct_conversations_admin_status
ON public.direct_conversations (admin_id, status, updated_at DESC);

-- Ensure uniqueness for (student_id, admin_id) on pre-existing databases.
-- 1) Repoint messages from duplicate conversations to the kept conversation.
-- 2) Remove duplicate conversation rows.
WITH ranked AS (
  SELECT
    dc.id,
    dc.student_id,
    dc.admin_id,
    FIRST_VALUE(dc.id) OVER (
      PARTITION BY dc.student_id, dc.admin_id
      ORDER BY dc.updated_at DESC, dc.created_at DESC, dc.id DESC
    ) AS keep_id,
    ROW_NUMBER() OVER (
      PARTITION BY dc.student_id, dc.admin_id
      ORDER BY dc.updated_at DESC, dc.created_at DESC, dc.id DESC
    ) AS rn
  FROM public.direct_conversations dc
),
dupes AS (
  SELECT id AS duplicate_id, keep_id
  FROM ranked
  WHERE rn > 1
)
UPDATE public.direct_messages dm
SET conversation_id = d.keep_id
FROM dupes d
WHERE dm.conversation_id = d.duplicate_id;

WITH ranked AS (
  SELECT
    dc.id,
    ROW_NUMBER() OVER (
      PARTITION BY dc.student_id, dc.admin_id
      ORDER BY dc.updated_at DESC, dc.created_at DESC, dc.id DESC
    ) AS rn
  FROM public.direct_conversations dc
)
DELETE FROM public.direct_conversations dc
USING ranked r
WHERE dc.id = r.id
  AND r.rn > 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'direct_conversations_student_id_admin_id_key'
      AND conrelid = 'public.direct_conversations'::regclass
  ) THEN
    ALTER TABLE public.direct_conversations
    ADD CONSTRAINT direct_conversations_student_id_admin_id_key
    UNIQUE (student_id, admin_id);
  END IF;
END;
$$;

ALTER TABLE public.direct_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own direct conversations" ON public.direct_conversations;
CREATE POLICY "Users can view own direct conversations"
  ON public.direct_conversations FOR SELECT
  USING (auth.uid() = student_id OR auth.uid() = admin_id OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Users can update own direct conversations" ON public.direct_conversations;
CREATE POLICY "Users can update own direct conversations"
  ON public.direct_conversations FOR UPDATE
  USING (auth.uid() = student_id OR auth.uid() = admin_id OR public.is_admin(auth.uid()))
  WITH CHECK (auth.uid() = student_id OR auth.uid() = admin_id OR public.is_admin(auth.uid()));

DROP TRIGGER IF EXISTS update_direct_conversations_updated_at ON public.direct_conversations;
CREATE TRIGGER update_direct_conversations_updated_at
  BEFORE UPDATE ON public.direct_conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.direct_messages
ADD COLUMN IF NOT EXISTS conversation_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'direct_messages_conversation_id_fkey'
      AND conrelid = 'public.direct_messages'::regclass
  ) THEN
    ALTER TABLE public.direct_messages
    ADD CONSTRAINT direct_messages_conversation_id_fkey
      FOREIGN KEY (conversation_id)
      REFERENCES public.direct_conversations(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_direct_messages_conversation_created
ON public.direct_messages (conversation_id, created_at DESC);

WITH role_pairs AS (
  SELECT
    dm.id AS message_id,
    CASE
      WHEN sender_profile.role = 'student' AND recipient_profile.role = 'admin' THEN dm.sender_id
      WHEN sender_profile.role = 'admin' AND recipient_profile.role = 'student' THEN dm.recipient_id
      ELSE NULL
    END AS student_id,
    CASE
      WHEN sender_profile.role = 'student' AND recipient_profile.role = 'admin' THEN dm.recipient_id
      WHEN sender_profile.role = 'admin' AND recipient_profile.role = 'student' THEN dm.sender_id
      ELSE NULL
    END AS admin_id
  FROM public.direct_messages dm
  JOIN public.profiles sender_profile ON sender_profile.id = dm.sender_id
  JOIN public.profiles recipient_profile ON recipient_profile.id = dm.recipient_id
), valid_pairs AS (
  SELECT message_id, student_id, admin_id
  FROM role_pairs
  WHERE student_id IS NOT NULL
    AND admin_id IS NOT NULL
), ensured_conversations AS (
  INSERT INTO public.direct_conversations (student_id, admin_id, status)
  SELECT DISTINCT vp.student_id, vp.admin_id, 'open'
  FROM valid_pairs vp
  ON CONFLICT (student_id, admin_id)
  DO UPDATE SET updated_at = now()
  RETURNING id, student_id, admin_id
)
UPDATE public.direct_messages dm
SET conversation_id = dc.id
FROM valid_pairs vp
JOIN public.direct_conversations dc
  ON dc.student_id = vp.student_id
 AND dc.admin_id = vp.admin_id
WHERE dm.id = vp.message_id
  AND dm.conversation_id IS NULL;

CREATE OR REPLACE FUNCTION public.get_or_create_direct_conversation_id(p_other_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_self_id UUID := auth.uid();
  v_self_role TEXT;
  v_other_role TEXT;
  v_student_id UUID;
  v_admin_id UUID;
  v_conversation_id UUID;
BEGIN
  IF v_self_id IS NULL THEN
    RAISE EXCEPTION 'Usuario nao autenticado';
  END IF;

  IF p_other_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario de destino invalido';
  END IF;

  SELECT p.role
  INTO v_self_role
  FROM public.profiles p
  WHERE p.id = v_self_id;

  SELECT p.role
  INTO v_other_role
  FROM public.profiles p
  WHERE p.id = p_other_user_id;

  IF v_self_role IS NULL OR v_other_role IS NULL THEN
    RAISE EXCEPTION 'Perfil de conversa nao encontrado';
  END IF;

  IF v_self_role = 'admin' THEN
    IF v_other_role <> 'student' THEN
      RAISE EXCEPTION 'Admin so pode conversar com aluno';
    END IF;
    v_admin_id := v_self_id;
    v_student_id := p_other_user_id;
  ELSIF v_self_role = 'student' THEN
    IF v_other_role <> 'admin' THEN
      RAISE EXCEPTION 'Aluno so pode conversar com professor';
    END IF;
    v_admin_id := p_other_user_id;
    v_student_id := v_self_id;
  ELSE
    RAISE EXCEPTION 'Papel invalido para conversa';
  END IF;

  INSERT INTO public.direct_conversations (student_id, admin_id, status)
  VALUES (v_student_id, v_admin_id, 'open')
  ON CONFLICT (student_id, admin_id)
  DO UPDATE SET updated_at = now()
  RETURNING id INTO v_conversation_id;

  RETURN v_conversation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_direct_conversation_status(
  p_other_user_id UUID,
  p_status TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT := lower(NULLIF(BTRIM(COALESCE(p_status, '')), ''));
  v_conversation_id UUID;
  v_other_name TEXT;
BEGIN
  IF v_status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'Status de conversa invalido';
  END IF;

  v_conversation_id := public.get_or_create_direct_conversation_id(p_other_user_id);

  UPDATE public.direct_conversations
  SET
    status = v_status,
    closed_at = CASE WHEN v_status = 'closed' THEN now() ELSE NULL END,
    closed_by = CASE WHEN v_status = 'closed' THEN auth.uid() ELSE NULL END,
    updated_at = now()
  WHERE id = v_conversation_id;

  SELECT COALESCE(NULLIF(BTRIM(p.full_name), ''), 'Usuario')
  INTO v_other_name
  FROM public.profiles p
  WHERE p.id = p_other_user_id;

  IF v_status = 'closed' THEN
    INSERT INTO public.notifications (user_id, type, title, message)
    VALUES (p_other_user_id, 'chat_closed', 'Chat encerrado', format('A conversa com %s foi encerrada.', v_other_name));
  ELSE
    INSERT INTO public.notifications (user_id, type, title, message)
    VALUES (p_other_user_id, 'chat_reopened', 'Nova conversa', format('A conversa com %s foi reaberta.', v_other_name));
  END IF;

  RETURN v_conversation_id;
END;
$$;

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
  v_conversation_id UUID;
  v_conversation_status TEXT;
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
    v_conversation_id := public.get_or_create_direct_conversation_id(v_admin.id);

    SELECT dc.status
    INTO v_conversation_status
    FROM public.direct_conversations dc
    WHERE dc.id = v_conversation_id;

    IF v_conversation_status = 'closed' THEN
      RAISE EXCEPTION 'Este chat esta encerrado. Clique em iniciar nova conversa para continuar.';
    END IF;

    INSERT INTO public.direct_messages (sender_id, recipient_id, message, conversation_id)
    VALUES (auth.uid(), v_admin.id, v_message, v_conversation_id);

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
  v_conversation_id UUID;
  v_conversation_status TEXT;
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

  v_conversation_id := public.get_or_create_direct_conversation_id(p_student_id);

  SELECT dc.status
  INTO v_conversation_status
  FROM public.direct_conversations dc
  WHERE dc.id = v_conversation_id;

  IF v_conversation_status = 'closed' THEN
    RAISE EXCEPTION 'Este chat esta encerrado. Clique em iniciar nova conversa para continuar.';
  END IF;

  INSERT INTO public.direct_messages (sender_id, recipient_id, message, conversation_id)
  VALUES (auth.uid(), p_student_id, v_message, v_conversation_id)
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
