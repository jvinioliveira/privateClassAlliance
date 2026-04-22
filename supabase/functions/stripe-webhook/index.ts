import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import { corsHeaders } from '../_shared/http.ts';
import { getStripeClient } from '../_shared/stripe.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET');

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !STRIPE_WEBHOOK_SECRET) {
  throw new Error('Missing env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_WEBHOOK_SECRET');
}

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const upsertWebhookEvent = async (payload: {
  stripe_event_id: string;
  event_type: string;
  livemode: boolean;
  order_id: string | null;
  raw_payload: unknown;
  processing_result: 'processed' | 'ignored' | 'failed';
  error_message?: string | null;
}) => {
  await supabaseAdmin.from('stripe_webhook_events').upsert(
    {
      stripe_event_id: payload.stripe_event_id,
      event_type: payload.event_type,
      livemode: payload.livemode,
      order_id: payload.order_id,
      payload: payload.raw_payload,
      processing_result: payload.processing_result,
      error_message: payload.error_message ?? null,
    },
    { onConflict: 'stripe_event_id' },
  );
};

const findOrderBySession = async (sessionId: string) => {
  const { data } = await supabaseAdmin
    .from('plan_orders')
    .select('id, status, credited_selection_id, stripe_payment_status')
    .eq('stripe_checkout_session_id', sessionId)
    .maybeSingle();

  return data;
};

const findOrderByPaymentIntent = async (paymentIntentId: string) => {
  const { data } = await supabaseAdmin
    .from('plan_orders')
    .select('id, status, credited_selection_id, stripe_payment_status')
    .eq('stripe_payment_intent_id', paymentIntentId)
    .maybeSingle();

  return data;
};

const processPaidOrder = async (args: {
  orderId: string;
  stripeEventId: string;
  checkoutSessionId?: string | null;
  paymentIntentId?: string | null;
  customerId?: string | null;
  amountTotalCents?: number | null;
  currency?: string | null;
  paymentMethodType?: string | null;
  paidAt?: string | null;
}) => {
  const { data, error } = await supabaseAdmin.rpc('process_stripe_paid_order', {
    p_order_id: args.orderId,
    p_stripe_event_id: args.stripeEventId,
    p_checkout_session_id: args.checkoutSessionId ?? null,
    p_payment_intent_id: args.paymentIntentId ?? null,
    p_customer_id: args.customerId ?? null,
    p_amount_total_cents: args.amountTotalCents ?? null,
    p_currency: (args.currency || 'brl').toLowerCase(),
    p_payment_method_type: args.paymentMethodType ?? null,
    p_paid_at: args.paidAt ?? new Date().toISOString(),
  });

  if (error) throw new Error(error.message);
  return data as { result?: string; credited?: boolean } | null;
};

const shouldIgnoreTerminalFailureTransition = (order: {
  status?: string | null;
  credited_selection_id?: string | null;
  stripe_payment_status?: string | null;
} | null) => {
  if (!order) return false;
  return order.status === 'approved' || !!order.credited_selection_id || order.stripe_payment_status === 'paid';
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return new Response('Missing stripe-signature header', { status: 400, headers: corsHeaders });
  }

  const body = await req.text();
  const stripe = getStripeClient();

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Invalid signature';
    return new Response(msg, { status: 400, headers: corsHeaders });
  }

  const { data: alreadyProcessed } = await supabaseAdmin
    .from('stripe_webhook_events')
    .select('id')
    .eq('stripe_event_id', event.id)
    .maybeSingle();

  if (alreadyProcessed) {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  let orderId: string | null = null;

  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object;
        orderId = session.metadata?.order_id ?? null;

        if (!orderId && session.id) {
          const bySession = await findOrderBySession(session.id);
          orderId = bySession?.id ?? null;
        }

        if (orderId) {
          const paymentIntentId =
            typeof session.payment_intent === 'string'
              ? session.payment_intent
              : session.payment_intent?.id ?? null;

          const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null;

          const paidAt = new Date().toISOString();

          await processPaidOrder({
            orderId,
            stripeEventId: event.id,
            checkoutSessionId: session.id,
            paymentIntentId,
            customerId,
            amountTotalCents: session.amount_total,
            currency: session.currency,
            paidAt,
          });
        }
        break;
      }

      case 'payment_intent.succeeded': {
        const intent = event.data.object;
        const byIntent = await findOrderByPaymentIntent(intent.id);
        orderId = byIntent?.id ?? null;

        if (orderId) {
          await processPaidOrder({
            orderId,
            stripeEventId: event.id,
            paymentIntentId: intent.id,
            customerId: typeof intent.customer === 'string' ? intent.customer : null,
            amountTotalCents: intent.amount_received || intent.amount,
            currency: intent.currency,
            paymentMethodType: intent.payment_method_types?.[0] ?? null,
            paidAt: new Date().toISOString(),
          });
        }
        break;
      }

      case 'checkout.session.async_payment_failed':
      case 'payment_intent.payment_failed': {
        const intent = event.type === 'payment_intent.payment_failed' ? event.data.object : null;
        const intentId = intent?.id ?? null;

        if (intentId) {
          const order = await findOrderByPaymentIntent(intentId);
          orderId = order?.id ?? null;

          if (orderId && !shouldIgnoreTerminalFailureTransition(order)) {
            await supabaseAdmin
              .from('plan_orders')
              .update({
                status: 'pending_payment',
                stripe_payment_status: 'payment_failed',
                stripe_latest_event_id: event.id,
                last_payment_error: intent?.last_payment_error?.message ?? 'Pagamento falhou',
                payment_updated_at: new Date().toISOString(),
              })
              .eq('id', orderId);
          }
        }
        break;
      }

      case 'checkout.session.expired': {
        const session = event.data.object;
        orderId = session.metadata?.order_id ?? null;

        if (!orderId && session.id) {
          const order = await findOrderBySession(session.id);
          orderId = order?.id ?? null;
        }

        if (orderId) {
          const order = session.id ? await findOrderBySession(session.id) : null;
          if (!shouldIgnoreTerminalFailureTransition(order)) {
            await supabaseAdmin
              .from('plan_orders')
              .update({
                status: 'cancelled',
                stripe_payment_status: 'expired',
                stripe_latest_event_id: event.id,
                admin_notes: 'Checkout Stripe expirado antes da conclusão. O aluno pode gerar um novo checkout.',
                payment_updated_at: new Date().toISOString(),
              })
              .eq('id', orderId);
          }
        }
        break;
      }

      case 'charge.refunded': {
        const charge = event.data.object;
        const paymentIntentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : null;

        if (paymentIntentId) {
          const byIntent = await findOrderByPaymentIntent(paymentIntentId);
          orderId = byIntent?.id ?? null;
        }

        if (orderId) {
          const isFull = (charge.amount_refunded ?? 0) >= (charge.amount ?? 0);

          await supabaseAdmin
            .from('plan_orders')
            .update({
              stripe_payment_status: isFull ? 'refunded' : 'partially_refunded',
              refund_status: isFull ? 'full' : 'partial',
              refunded_at: new Date().toISOString(),
              requires_refund_review: true,
              refund_review_reason: isFull
                ? 'Reembolso total confirmado pela Stripe. Verificar ajuste de créditos manualmente.'
                : 'Reembolso parcial confirmado pela Stripe. Verificar ajuste de créditos manualmente.',
              stripe_latest_event_id: event.id,
              payment_updated_at: new Date().toISOString(),
            })
            .eq('id', orderId);
        }
        break;
      }

      default:
        await upsertWebhookEvent({
          stripe_event_id: event.id,
          event_type: event.type,
          livemode: !!event.livemode,
          order_id: null,
          raw_payload: event,
          processing_result: 'ignored',
          error_message: null,
        });

        return new Response('ok', { status: 200, headers: corsHeaders });
    }

    await upsertWebhookEvent({
      stripe_event_id: event.id,
      event_type: event.type,
      livemode: !!event.livemode,
      order_id: orderId,
      raw_payload: event,
      processing_result: 'processed',
      error_message: null,
    });

    return new Response('ok', { status: 200, headers: corsHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Webhook processing error';

    await upsertWebhookEvent({
      stripe_event_id: event.id,
      event_type: event.type,
      livemode: !!event.livemode,
      order_id: orderId,
      raw_payload: event,
      processing_result: 'failed',
      error_message: message,
    });

    return new Response(message, { status: 500, headers: corsHeaders });
  }
});
