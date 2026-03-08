-- Marketing notifications for lesson plan launches and updates

CREATE OR REPLACE FUNCTION public.notify_lesson_plan_marketing()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type TEXT;
  v_title TEXT;
  v_message TEXT;
  v_total_price TEXT;
  v_unit_price TEXT;
  v_old_price TEXT;
  v_new_price TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT NEW.is_active THEN
      RETURN NEW;
    END IF;

    v_total_price := REPLACE(to_char(NEW.price_cents::numeric / 100, 'FM999G999G990D00'), '.', ',');
    v_unit_price := REPLACE(to_char((NEW.price_cents::numeric / GREATEST(NEW.credits, 1)) / 100, 'FM999G999G990D00'), '.', ',');

    v_type := 'plan_new_marketing';
    v_title := 'Novo plano disponível';
    v_message := format(
      'Chegou o plano "%s": %s créditos por R$ %s (aprox. R$ %s por aula). Aproveite para garantir constância no treino!',
      NEW.name,
      NEW.credits,
      v_total_price,
      v_unit_price
    );
  ELSE
    IF NOT NEW.is_active THEN
      RETURN NEW;
    END IF;

    IF NEW.name IS NOT DISTINCT FROM OLD.name
      AND NEW.description IS NOT DISTINCT FROM OLD.description
      AND NEW.class_type IS NOT DISTINCT FROM OLD.class_type
      AND NEW.credits IS NOT DISTINCT FROM OLD.credits
      AND NEW.price_cents IS NOT DISTINCT FROM OLD.price_cents
      AND NEW.is_active IS NOT DISTINCT FROM OLD.is_active THEN
      RETURN NEW;
    END IF;

    v_total_price := REPLACE(to_char(NEW.price_cents::numeric / 100, 'FM999G999G990D00'), '.', ',');
    v_unit_price := REPLACE(to_char((NEW.price_cents::numeric / GREATEST(NEW.credits, 1)) / 100, 'FM999G999G990D00'), '.', ',');

    IF OLD.is_active = false AND NEW.is_active = true THEN
      v_type := 'plan_new_marketing';
      v_title := 'Plano reativado com nova oportunidade';
      v_message := format(
        'O plano "%s" voltou ao app: %s créditos por R$ %s. Se encaixar na sua rotina, garanta já sua evolução!',
        NEW.name,
        NEW.credits,
        v_total_price
      );
    ELSIF NEW.price_cents IS DISTINCT FROM OLD.price_cents THEN
      v_old_price := REPLACE(to_char(OLD.price_cents::numeric / 100, 'FM999G999G990D00'), '.', ',');
      v_new_price := REPLACE(to_char(NEW.price_cents::numeric / 100, 'FM999G999G990D00'), '.', ',');

      v_type := 'plan_price_updated_marketing';
      v_title := 'Atualização de valor em plano';
      v_message := format(
        'O plano "%s" mudou de valor: de R$ %s para R$ %s. Confira se esse plano faz sentido para seu próximo ciclo de treinos.',
        NEW.name,
        v_old_price,
        v_new_price
      );
    ELSE
      v_type := 'plan_updated_marketing';
      v_title := 'Plano atualizado';
      v_message := format(
        'Atualizamos o plano "%s": %s créditos por R$ %s (aprox. R$ %s por aula). Veja as novidades e escolha seu melhor ritmo!',
        NEW.name,
        NEW.credits,
        v_total_price,
        v_unit_price
      );
    END IF;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, message)
  SELECT p.id, v_type, v_title, v_message
  FROM public.profiles p
  WHERE p.role = 'student';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_lesson_plan_marketing_notify ON public.lesson_plans;
CREATE TRIGGER on_lesson_plan_marketing_notify
  AFTER INSERT OR UPDATE OF name, description, class_type, credits, price_cents, is_active
  ON public.lesson_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_lesson_plan_marketing();
