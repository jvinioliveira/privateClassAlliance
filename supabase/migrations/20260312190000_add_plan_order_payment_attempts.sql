-- Auditoria de tentativas de pagamento em checkout (NuPay)

CREATE TABLE IF NOT EXISTS public.plan_order_payment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.plan_orders(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'nupay' CHECK (provider IN ('nupay')),
  event_name TEXT NOT NULL DEFAULT 'checkout_opened' CHECK (event_name IN ('checkout_opened')),
  user_agent TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_order_payment_attempts_order_time
ON public.plan_order_payment_attempts (order_id, attempted_at DESC);

CREATE INDEX IF NOT EXISTS idx_plan_order_payment_attempts_user_time
ON public.plan_order_payment_attempts (user_id, attempted_at DESC);

ALTER TABLE public.plan_order_payment_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Students can view own payment attempts" ON public.plan_order_payment_attempts;
CREATE POLICY "Students can view own payment attempts"
  ON public.plan_order_payment_attempts FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Students can insert own payment attempts" ON public.plan_order_payment_attempts;
CREATE POLICY "Students can insert own payment attempts"
  ON public.plan_order_payment_attempts FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.plan_orders po
      WHERE po.id = order_id
        AND po.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins can view all payment attempts" ON public.plan_order_payment_attempts;
CREATE POLICY "Admins can view all payment attempts"
  ON public.plan_order_payment_attempts FOR SELECT
  USING (public.is_admin(auth.uid()));

REVOKE ALL ON TABLE public.plan_order_payment_attempts FROM anon;
REVOKE UPDATE, DELETE ON TABLE public.plan_order_payment_attempts FROM authenticated;
GRANT SELECT, INSERT ON TABLE public.plan_order_payment_attempts TO authenticated;
