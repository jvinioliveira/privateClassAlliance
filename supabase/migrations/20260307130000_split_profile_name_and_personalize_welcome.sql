-- Split profile name into first_name and last_name, and personalize welcome notification
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT;

-- Backfill first/last name from full_name for existing users
UPDATE public.profiles
SET
  first_name = COALESCE(
    NULLIF(first_name, ''),
    NULLIF(split_part(BTRIM(COALESCE(full_name, '')), ' ', 1), '')
  ),
  last_name = COALESCE(
    NULLIF(last_name, ''),
    NULLIF(BTRIM(regexp_replace(BTRIM(COALESCE(full_name, '')), '^\S+\s*', '')), '')
  );

-- Keep full_name populated when first/last are available
UPDATE public.profiles
SET full_name = NULLIF(BTRIM(concat_ws(' ', NULLIF(first_name, ''), NULLIF(last_name, ''))), '')
WHERE full_name IS NULL OR BTRIM(full_name) = '';

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_first_name TEXT;
  v_last_name TEXT;
  v_greeting_name TEXT;
BEGIN
  v_full_name := NULLIF(BTRIM(COALESCE(NEW.raw_user_meta_data->>'full_name', '')), '');
  v_first_name := NULLIF(BTRIM(COALESCE(NEW.raw_user_meta_data->>'first_name', '')), '');
  v_last_name := NULLIF(BTRIM(COALESCE(NEW.raw_user_meta_data->>'last_name', '')), '');

  IF v_full_name IS NULL THEN
    v_full_name := NULLIF(BTRIM(concat_ws(' ', v_first_name, v_last_name)), '');
  END IF;

  IF v_first_name IS NULL AND v_full_name IS NOT NULL THEN
    v_first_name := NULLIF(split_part(v_full_name, ' ', 1), '');
  END IF;

  IF v_last_name IS NULL AND v_full_name IS NOT NULL THEN
    v_last_name := NULLIF(BTRIM(regexp_replace(v_full_name, '^\S+\s*', '')), '');
  END IF;

  INSERT INTO public.profiles (id, full_name, first_name, last_name, role)
  VALUES (
    NEW.id,
    v_full_name,
    v_first_name,
    v_last_name,
    'student'
  );

  v_greeting_name := COALESCE(v_first_name, NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''), 'Aluno');

  INSERT INTO public.notifications (user_id, type, title, message)
  VALUES (
    NEW.id,
    'welcome',
    'Bem-vindo(a)!',
    format('Sua conta foi criada com sucesso, %s. Quando quiser, escolha seu plano e agende sua primeira aula.', v_greeting_name)
  );

  RETURN NEW;
END;
$$;

-- Optional: refresh existing welcome notifications with first name
UPDATE public.notifications n
SET message = format(
  'Sua conta foi criada com sucesso, %s. Quando quiser, escolha seu plano e agende sua primeira aula.',
  COALESCE(NULLIF(p.first_name, ''), 'Aluno')
)
FROM public.profiles p
WHERE n.user_id = p.id
  AND n.type = 'welcome';
