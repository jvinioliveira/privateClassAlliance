-- Ensure "start new conversation" creates a new thread instead of reusing old messages.
-- Strategy:
-- 1) Allow multiple conversations per student/admin pair.
-- 2) Keep at most one OPEN conversation per pair.
-- 3) get_or_create returns current OPEN conversation (or creates one).
-- 4) set_direct_conversation_status('open') always opens a fresh conversation.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'direct_conversations_student_id_admin_id_key'
      AND conrelid = 'public.direct_conversations'::regclass
  ) THEN
    ALTER TABLE public.direct_conversations
    DROP CONSTRAINT direct_conversations_student_id_admin_id_key;
  END IF;
END;
$$;

DROP INDEX IF EXISTS idx_direct_conversations_unique_open_pair;
CREATE UNIQUE INDEX IF NOT EXISTS idx_direct_conversations_unique_open_pair
ON public.direct_conversations (student_id, admin_id)
WHERE status = 'open';

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

  SELECT dc.id
  INTO v_conversation_id
  FROM public.direct_conversations dc
  WHERE dc.student_id = v_student_id
    AND dc.admin_id = v_admin_id
    AND dc.status = 'open'
  ORDER BY dc.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_conversation_id IS NULL THEN
    INSERT INTO public.direct_conversations (student_id, admin_id, status)
    VALUES (v_student_id, v_admin_id, 'open')
    RETURNING id INTO v_conversation_id;
  END IF;

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
  v_self_id UUID := auth.uid();
  v_self_role TEXT;
  v_other_role TEXT;
  v_student_id UUID;
  v_admin_id UUID;
  v_conversation_id UUID;
  v_other_name TEXT;
BEGIN
  IF v_self_id IS NULL THEN
    RAISE EXCEPTION 'Usuario nao autenticado';
  END IF;

  IF v_status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'Status de conversa invalido';
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

  IF v_status = 'closed' THEN
    SELECT dc.id
    INTO v_conversation_id
    FROM public.direct_conversations dc
    WHERE dc.student_id = v_student_id
      AND dc.admin_id = v_admin_id
      AND dc.status = 'open'
    ORDER BY dc.created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_conversation_id IS NULL THEN
      RAISE EXCEPTION 'Nao existe conversa ativa para encerrar.';
    END IF;

    UPDATE public.direct_conversations
    SET
      status = 'closed',
      closed_at = now(),
      closed_by = v_self_id,
      updated_at = now()
    WHERE id = v_conversation_id;
  ELSE
    -- Ensure we always open a fresh thread when user clicks "start new conversation".
    UPDATE public.direct_conversations
    SET
      status = 'closed',
      closed_at = now(),
      closed_by = v_self_id,
      updated_at = now()
    WHERE student_id = v_student_id
      AND admin_id = v_admin_id
      AND status = 'open';

    INSERT INTO public.direct_conversations (student_id, admin_id, status)
    VALUES (v_student_id, v_admin_id, 'open')
    RETURNING id INTO v_conversation_id;
  END IF;

  SELECT COALESCE(NULLIF(BTRIM(p.full_name), ''), 'Usuario')
  INTO v_other_name
  FROM public.profiles p
  WHERE p.id = p_other_user_id;

  IF v_status = 'closed' THEN
    INSERT INTO public.notifications (user_id, type, title, message)
    VALUES (p_other_user_id, 'chat_closed', 'Chat encerrado', format('A conversa com %s foi encerrada.', v_other_name));
  ELSE
    INSERT INTO public.notifications (user_id, type, title, message)
    VALUES (p_other_user_id, 'chat_reopened', 'Nova conversa', format('Uma nova conversa com %s foi iniciada.', v_other_name));
  END IF;

  RETURN v_conversation_id;
END;
$$;

