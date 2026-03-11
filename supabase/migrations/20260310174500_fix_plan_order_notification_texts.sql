-- Ajusta textos de notificações com acentuação correta em português.

CREATE OR REPLACE FUNCTION public.notify_plan_order_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expiration_date DATE;
  v_wallet_expires_at TIMESTAMPTZ;
  v_message TEXT;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'approved' THEN
    IF NEW.credited_selection_id IS NOT NULL THEN
      SELECT sps.expires_at
      INTO v_wallet_expires_at
      FROM public.student_plan_selections sps
      WHERE sps.id = NEW.credited_selection_id;
    END IF;

    IF v_wallet_expires_at IS NOT NULL THEN
      v_expiration_date := (v_wallet_expires_at AT TIME ZONE 'America/Sao_Paulo')::date;
    ELSIF NEW.approved_at IS NOT NULL THEN
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
    IF OLD.status = 'pending_payment'
       AND NEW.payment_confirmed_at IS NULL
       AND NEW.plan_type = 'fixed'
       AND NEW.approved_by IS NULL THEN
      v_message := format(
        'Seu pedido "%s" foi cancelado porque o prazo para informar o pagamento expirou.',
        NEW.plan_name
      );
    ELSE
      v_message := format(
        'Seu pedido "%s" foi cancelado. Entre em contato com o professor para mais detalhes.',
        NEW.plan_name
      );
    END IF;

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
