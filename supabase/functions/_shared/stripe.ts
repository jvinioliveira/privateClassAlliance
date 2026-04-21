import Stripe from 'npm:stripe@16.12.0';

export const getStripeClient = () => {
  const secretKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!secretKey) {
    throw new Error('Missing STRIPE_SECRET_KEY');
  }

  return new Stripe(secretKey, {
    apiVersion: '2024-06-20',
    httpClient: Stripe.createFetchHttpClient(),
  });
};
