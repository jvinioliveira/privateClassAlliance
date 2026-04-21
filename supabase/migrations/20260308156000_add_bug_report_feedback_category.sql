-- Add bug-report category for student feedback form.

ALTER TABLE public.student_feedback_submissions
DROP CONSTRAINT IF EXISTS student_feedback_submissions_category_check;

-- Normalize legacy categories before applying the strict check.
UPDATE public.student_feedback_submissions
SET category = 'other'
WHERE category IS NULL
   OR category NOT IN ('complaint', 'compliment', 'suggestion', 'other', 'bug');

ALTER TABLE public.student_feedback_submissions
ADD CONSTRAINT student_feedback_submissions_category_check
CHECK (category IN ('complaint', 'compliment', 'suggestion', 'other', 'bug'));

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
  IF v_category IS NULL OR v_category NOT IN ('complaint', 'compliment', 'suggestion', 'other', 'bug') THEN
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
