-- Notify admins when a new plan order is created by a student.

CREATE OR REPLACE FUNCTION public.notify_admins_new_plan_order()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, type, title, message)
  SELECT
    p.id,
    'plan_order_new',
    'Novo pedido de compra',
    format(
      'Novo pedido recebido: %s (%s créditos, %s).',
      NEW.plan_name,
      NEW.credits_amount,
      CASE WHEN NEW.class_type = 'double' THEN 'aula em dupla' ELSE 'aula individual' END
    )
  FROM public.profiles p
  WHERE p.role = 'admin';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_admins_new_plan_order_trigger ON public.plan_orders;
CREATE TRIGGER notify_admins_new_plan_order_trigger
  AFTER INSERT ON public.plan_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_admins_new_plan_order();
