-- Stripe checkout integration: financial fields, webhook events, and compatibility updates.

ALTER TABLE public.plan_orders
DROP CONSTRAINT IF EXISTS plan_orders_payment_method_check;

ALTER TABLE public.plan_orders
ADD CONSTRAINT plan_orders_payment_method_check
CHECK (
  payment_method IS NULL
  OR payment_method IN ('pix', 'credit_link', 'manual_contact', 'stripe_checkout')
);

ALTER TABLE public.plan_orders
ADD COLUMN IF NOT EXISTS payment_provider TEXT,
ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT,
ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT,
ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
ADD COLUMN IF NOT EXISTS stripe_checkout_url TEXT,
ADD COLUMN IF NOT EXISTS stripe_payment_status TEXT,
ADD COLUMN IF NOT EXISTS currency TEXT,
ADD COLUMN IF NOT EXISTS amount_subtotal_cents INT,
ADD COLUMN IF NOT EXISTS amount_total_cents INT,
ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS payment_method_type TEXT,
ADD COLUMN IF NOT EXISTS last_payment_error TEXT,
ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS refund_status TEXT,
ADD COLUMN IF NOT EXISTS stripe_latest_event_id TEXT,
ADD COLUMN IF NOT EXISTS payment_updated_at TIMESTAMPTZ;

UPDATE public.plan_orders
SET
  currency = COALESCE(currency, 'brl'),
  refund_status = COALESCE(refund_status, 'none'),
  amount_total_cents = COALESCE(amount_total_cents, price_amount_cents),
  amount_subtotal_cents = COALESCE(amount_subtotal_cents, price_amount_cents)
WHERE
  currency IS NULL
  OR refund_status IS NULL
  OR amount_total_cents IS NULL
  OR amount_subtotal_cents IS NULL;

ALTER TABLE public.plan_orders
ALTER COLUMN currency SET DEFAULT 'brl',
ALTER COLUMN refund_status SET DEFAULT 'none';

ALTER TABLE public.plan_orders
DROP CONSTRAINT IF EXISTS plan_orders_payment_provider_check;

ALTER TABLE public.plan_orders
ADD CONSTRAINT plan_orders_payment_provider_check
CHECK (payment_provider IS NULL OR payment_provider IN ('legacy_nupay', 'stripe'));

ALTER TABLE public.plan_orders
DROP CONSTRAINT IF EXISTS plan_orders_stripe_payment_status_check;

ALTER TABLE public.plan_orders
ADD CONSTRAINT plan_orders_stripe_payment_status_check
CHECK (
  stripe_payment_status IS NULL
  OR stripe_payment_status IN (
    'unpaid',
    'paid',
    'payment_failed',
    'expired',
    'refunded',
    'partially_refunded',
    'pending_review'
  )
);

ALTER TABLE public.plan_orders
DROP CONSTRAINT IF EXISTS plan_orders_refund_status_check;

ALTER TABLE public.plan_orders
ADD CONSTRAINT plan_orders_refund_status_check
CHECK (
  refund_status IS NULL
  OR refund_status IN ('none', 'partial', 'full')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_orders_stripe_checkout_session
ON public.plan_orders (stripe_checkout_session_id)
WHERE stripe_checkout_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_plan_orders_stripe_payment_intent
ON public.plan_orders (stripe_payment_intent_id)
WHERE stripe_payment_intent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_plan_orders_payment_provider_status
ON public.plan_orders (payment_provider, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  livemode BOOLEAN NOT NULL DEFAULT false,
  order_id UUID REFERENCES public.plan_orders(id) ON DELETE SET NULL,
  payload JSONB NOT NULL,
  processing_result TEXT NOT NULL DEFAULT 'processed',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_stripe_webhook_events_event_id
ON public.stripe_webhook_events (stripe_event_id);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_order
ON public.stripe_webhook_events (order_id, created_at DESC);

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view stripe webhook events" ON public.stripe_webhook_events;
CREATE POLICY "Admins can view stripe webhook events"
  ON public.stripe_webhook_events FOR SELECT
  USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Service role can manage stripe webhook events" ON public.stripe_webhook_events;
CREATE POLICY "Service role can manage stripe webhook events"
  ON public.stripe_webhook_events FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

ALTER TABLE public.plan_order_payment_attempts
ADD COLUMN IF NOT EXISTS checkout_session_id TEXT,
ADD COLUMN IF NOT EXISTS amount_cents INT,
ADD COLUMN IF NOT EXISTS currency TEXT;

UPDATE public.plan_order_payment_attempts
SET currency = COALESCE(currency, 'brl')
WHERE currency IS NULL;

ALTER TABLE public.plan_order_payment_attempts
ALTER COLUMN currency SET DEFAULT 'brl';

ALTER TABLE public.plan_order_payment_attempts
DROP CONSTRAINT IF EXISTS plan_order_payment_attempts_provider_check;

ALTER TABLE public.plan_order_payment_attempts
ADD CONSTRAINT plan_order_payment_attempts_provider_check
CHECK (provider IN ('nupay', 'stripe'));

ALTER TABLE public.plan_order_payment_attempts
DROP CONSTRAINT IF EXISTS plan_order_payment_attempts_event_name_check;

ALTER TABLE public.plan_order_payment_attempts
ADD CONSTRAINT plan_order_payment_attempts_event_name_check
CHECK (event_name IN ('checkout_opened', 'checkout_session_created', 'checkout_redirected', 'checkout_returned'));

CREATE INDEX IF NOT EXISTS idx_plan_order_payment_attempts_session
ON public.plan_order_payment_attempts (checkout_session_id)
WHERE checkout_session_id IS NOT NULL;
