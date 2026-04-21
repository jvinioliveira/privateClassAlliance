import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import type Stripe from 'npm:stripe@16.12.0';
import { corsHeaders, jsonResponse } from '../_shared/http.ts';
import { getStripeClient } from '../_shared/stripe.ts';

type PlanOrderRow = {
  id: string;
  user_id: string;
  plan_id: string | null;
  plan_name: string;
  plan_type: 'fixed' | 'custom';
  class_type: 'individual' | 'double';
  credits_amount: number;
  custom_quantity: number | null;
  price_amount_cents: number;
  status: string;
  stripe_payment_status: string | null;
  currency: string | null;
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
  throw new Error('Missing Supabase env vars: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY');
}

const SITE_URL = (Deno.env.get('SITE_URL') || 'http://localhost:8080').replace(/\/$/, '');

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const getUserFromAuthHeader = async (authHeader: string | null) => {
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing Authorization header');
  }

  const token = authHeader.slice('Bearer '.length);
  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data.user) {
    throw new Error('Unauthorized');
  }

  return data.user;
};

const recalculateOrderAmountCents = async (order: PlanOrderRow) => {
  if (order.plan_type === 'fixed') {
    if (!order.plan_id) {
      throw new Error('Invalid fixed order without plan_id');
    }

    const { data: plan, error: planError } = await supabaseAdmin
      .from('lesson_plans')
      .select('price_cents')
      .eq('id', order.plan_id)
      .maybeSingle();

    if (planError || !plan) {
      throw new Error('Plan not found for this order');
    }

    const price = Number(plan.price_cents ?? 0);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error('Invalid plan price configured');
    }

    return price;
  }

  const quantity = Math.max(order.custom_quantity ?? order.credits_amount, 1);
  const { data: unitPriceRaw, error: unitPriceError } = await supabaseAdmin.rpc('get_custom_plan_unit_price_cents', {
    p_class_type: order.class_type,
    p_credits: quantity,
  });

  if (unitPriceError) {
    throw new Error(`Could not recalculate custom price: ${unitPriceError.message}`);
  }

  const unit = Number(unitPriceRaw ?? 0);
  const total = Math.round(unit * quantity);

  if (!Number.isFinite(total) || total <= 0) {
    throw new Error('Invalid custom plan price configured');
  }

  return total;
};

const createStripeSession = async ({
  stripe,
  userEmail,
  order,
  amountCents,
}: {
  stripe: Stripe;
  userEmail: string | undefined;
  order: PlanOrderRow;
  amountCents: number;
}) => {
  const currency = (order.currency || 'brl').toLowerCase();
  const successUrl = `${SITE_URL}/plans/checkout/success?orderId=${order.id}&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${SITE_URL}/plans/checkout/cancel?orderId=${order.id}`;

  return stripe.checkout.sessions.create({
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: userEmail,
    payment_method_types: ['card', 'pix'],
    allow_promotion_codes: true,
    expires_at: Math.floor(Date.now() / 1000) + 60 * 30,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency,
          unit_amount: amountCents,
          product_data: {
            name: order.plan_name,
            description: `${order.credits_amount} créditos • ${order.class_type === 'double' ? 'Aula em dupla' : 'Aula individual'}`,
          },
        },
      },
    ],
    metadata: {
      order_id: order.id,
      user_id: order.user_id,
      plan_type: order.plan_type,
      credits_amount: String(order.credits_amount),
      class_type: order.class_type,
    },
    automatic_tax: { enabled: false },
  });
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Method not allowed' });
  }

  try {
    const user = await getUserFromAuthHeader(req.headers.get('Authorization'));
    const body = await req.json();
    const orderId = typeof body?.orderId === 'string' ? body.orderId : '';

    if (!orderId) {
      return jsonResponse(400, { error: 'orderId is required' });
    }

    const { data: order, error: orderError } = await supabaseAdmin
      .from('plan_orders')
      .select('id, user_id, plan_id, plan_name, plan_type, class_type, credits_amount, custom_quantity, price_amount_cents, status, stripe_payment_status, currency')
      .eq('id', orderId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (orderError || !order) {
      return jsonResponse(404, { error: 'Pedido não encontrado' });
    }

    if (['approved', 'cancelled'].includes(order.status)) {
      return jsonResponse(400, { error: 'Esse pedido não está disponível para pagamento.' });
    }

    if (!['pending_payment', 'awaiting_contact', 'awaiting_approval'].includes(order.status)) {
      return jsonResponse(400, { error: 'Status inválido para checkout' });
    }

    if (order.status === 'awaiting_approval' && ['paid', 'pending_review'].includes(order.stripe_payment_status || '')) {
      return jsonResponse(400, { error: 'Esse pedido já tem pagamento confirmado e está aguardando aprovação.' });
    }

    const validatedAmount = await recalculateOrderAmountCents(order as PlanOrderRow);

    const stripe = getStripeClient();
    const session = await createStripeSession({
      stripe,
      userEmail: user.email,
      order: order as PlanOrderRow,
      amountCents: validatedAmount,
    });

    const normalizedStatus = order.status === 'awaiting_contact' ? 'pending_payment' : order.status;

    const { error: updateError } = await supabaseAdmin
      .from('plan_orders')
      .update({
        price_amount_cents: validatedAmount,
        amount_subtotal_cents: session.amount_subtotal ?? validatedAmount,
        amount_total_cents: session.amount_total ?? validatedAmount,
        currency: (session.currency || 'brl').toLowerCase(),
        payment_provider: 'stripe',
        payment_method: 'stripe_checkout',
        stripe_checkout_session_id: session.id,
        stripe_checkout_url: session.url,
        stripe_payment_status: session.payment_status === 'paid' ? 'paid' : 'unpaid',
        payment_updated_at: new Date().toISOString(),
        status: normalizedStatus,
      })
      .eq('id', order.id);

    if (updateError) {
      return jsonResponse(500, { error: updateError.message });
    }

    await supabaseAdmin.from('plan_order_payment_attempts').insert({
      order_id: order.id,
      user_id: user.id,
      provider: 'stripe',
      event_name: 'checkout_session_created',
      checkout_session_id: session.id,
      amount_cents: validatedAmount,
      currency: (session.currency || 'brl').toLowerCase(),
      user_agent: req.headers.get('user-agent'),
    });

    return jsonResponse(200, {
      orderId: order.id,
      checkoutUrl: session.url,
      sessionId: session.id,
      amountCents: validatedAmount,
      currency: (session.currency || 'brl').toLowerCase(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error';
    const status = message === 'Unauthorized' || message === 'Missing Authorization header' ? 401 : 500;
    return jsonResponse(status, { error: message });
  }
});
