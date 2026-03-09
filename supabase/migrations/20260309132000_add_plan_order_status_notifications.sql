-- Notify student when plan order is reviewed by teacher/admin.

CREATE OR REPLACE FUNCTION public.notify_plan_order_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expiration_date DATE;
  v_message TEXT;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'approved' THEN
    IF NEW.approved_at IS NOT NULL THEN
      v_expiration_date := ((NEW.approved_at + make_interval(days => NEW.validity_days)) AT TIME ZONE 'America/Sao_Paulo')::date;
    ELSE
      v_expiration_date := ((now() + make_interval(days => NEW.validity_days)) AT TIME ZONE 'America/Sao_Paulo')::date;
    END IF;

    v_message := format(
      'Seu pedido "%s" foi aprovado. %s créditos foram adicionados e a validade vai até %s.',
      NEW.plan_name,
      NEW.credits_amount,
      to_char(v_expiration_date, 'DD/MM/YYYY')
    );

    INSERT INTO public.notifications (user_id, type, title, message)
    VALUES (
      NEW.user_id,
      'credit_purchase_approved',
      'Créditos liberados',
      v_message
    );

    RETURN NEW;
  END IF;

  IF NEW.status = 'cancelled' THEN
    v_message := format(
      'Seu pedido "%s" foi cancelado. Entre em contato com o professor para mais detalhes.',
      NEW.plan_name
    );

    INSERT INTO public.notifications (user_id, type, title, message)
    VALUES (
      NEW.user_id,
      'credit_purchase_cancelled',
      'Pedido cancelado',
      v_message
    );

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_plan_order_status_change ON public.plan_orders;
CREATE TRIGGER trigger_notify_plan_order_status_change
  AFTER UPDATE ON public.plan_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_plan_order_status_change();
