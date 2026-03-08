-- Add welcome notification on account creation
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

  INSERT INTO public.notifications (user_id, type, title, message)
  VALUES (
    NEW.id,
    'welcome',
    'Bem-vindo(a)!',
    'Sua conta foi criada com sucesso. Quando quiser, escolha seu plano e agende sua primeira aula.'
  );

  RETURN NEW;
END;
$$;
