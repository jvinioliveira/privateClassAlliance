import { useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  formatCurrencyBRL,
  formatDateTimeBR,
  getClassTypeLabel,
  getPaymentMethodLabel,
  getPlanOrderStatusLabel,
  type PlanOrder,
  type PlanOrderStatus,
} from '@/lib/plan-orders';

type CheckoutSessionResponse = {
  checkoutUrl?: string;
  sessionId?: string;
  error?: string;
};

const getStatusVariant = (status: PlanOrderStatus): 'default' | 'secondary' | 'destructive' | 'outline' => {
  if (status === 'approved') return 'default';
  if (status === 'awaiting_approval') return 'secondary';
  if (status === 'cancelled') return 'destructive';
  return 'outline';
};

const isStripeCheckoutAllowed = (order: PlanOrder) => {
  if (order.status === 'approved' || order.status === 'cancelled') return false;
  return order.plan_type === 'fixed' || order.plan_type === 'custom';
};

const PlanCheckoutPage = () => {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: order, isLoading, isError } = useQuery({
    queryKey: ['plan-order', orderId, user?.id],
    queryFn: async () => {
      if (!orderId || !user) return null;

      await supabase.rpc('expire_stale_plan_orders', { p_user_id: user.id });

      const { data, error } = await supabase
        .from('plan_orders')
        .select('*')
        .eq('id', orderId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;
      return (data as PlanOrder | null) ?? null;
    },
    enabled: !!orderId && !!user,
    refetchInterval: (query) => {
      const current = query.state.data as PlanOrder | null | undefined;
      if (!current) return 12000;
      return current.status === 'pending_payment' || current.status === 'awaiting_approval' ? 8000 : false;
    },
  });

  const createStripeCheckoutMutation = useMutation({
    mutationFn: async () => {
      if (!orderId) throw new Error('Pedido inválido.');

      const { data, error } = await supabase.functions.invoke('create-stripe-checkout-session', {
        body: { orderId },
      });

      if (error) {
        throw new Error(error.message || 'Não foi possível iniciar o checkout no Stripe.');
      }

      const payload = (data ?? {}) as CheckoutSessionResponse;
      if (!payload.checkoutUrl) {
        throw new Error(payload.error || 'Stripe não retornou URL de checkout.');
      }

      return payload;
    },
    onSuccess: async (payload) => {
      if (!orderId || !user?.id) return;

      await supabase.from('plan_order_payment_attempts').insert({
        order_id: orderId,
        user_id: user.id,
        provider: 'stripe',
        event_name: 'checkout_redirected',
        user_agent: typeof window !== 'undefined' ? window.navigator.userAgent : null,
      });

      window.location.href = payload.checkoutUrl as string;
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const canStartStripeCheckout = !!order && isStripeCheckoutAllowed(order);

  const paymentGuidance = useMemo(() => {
    if (!order) return null;

    if (order.status === 'approved') {
      return 'Pagamento confirmado e créditos já liberados. Você pode continuar os agendamentos normalmente.';
    }

    if (order.status === 'awaiting_approval') {
      return 'Pagamento recebido. A liberação dos créditos está em revisão administrativa.';
    }

    if (order.status === 'cancelled') {
      if ((order.admin_notes || '').toLowerCase().includes('expira')) {
        return 'Este checkout expirou. Gere um novo pedido para continuar.';
      }
      return 'Pedido cancelado. Se foi um erro, crie um novo pedido ou fale com o suporte.';
    }

    if (order.plan_type === 'custom') {
      return 'Plano personalizado com valor validado no servidor. Você pode pagar com Stripe com segurança.';
    }

    return 'Pagamento único via Stripe Checkout. Cartão e Pix disponíveis conforme sua conta Stripe.';
  }, [order]);

  if (isLoading) {
    return (
      <div className="flex justify-center p-8">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (isError || !order) {
    return (
      <div className="space-y-4 p-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <h1 className="font-display text-lg uppercase tracking-wider">Pagamento do plano</h1>
          <p className="mt-2 text-sm text-muted-foreground">Pedido não encontrado.</p>
          <Button className="mt-4" onClick={() => navigate('/plans')}>
            Voltar para planos
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="font-display text-lg uppercase tracking-wider">Checkout</h1>
          <Badge variant={getStatusVariant(order.status)}>{getPlanOrderStatusLabel(order.status)}</Badge>
        </div>
        {paymentGuidance && <p className="mt-2 text-sm text-muted-foreground">{paymentGuidance}</p>}
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="font-display text-sm uppercase tracking-wider">Resumo do pedido</h2>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:text-sm">
          <div className="rounded-md border border-border/70 bg-background/60 p-2">
            <p className="text-muted-foreground">Plano</p>
            <p className="font-medium text-foreground">{order.plan_name}</p>
          </div>
          <div className="rounded-md border border-border/70 bg-background/60 p-2">
            <p className="text-muted-foreground">Tipo</p>
            <p className="font-medium text-foreground">{getClassTypeLabel(order.class_type)}</p>
          </div>
          <div className="rounded-md border border-border/70 bg-background/60 p-2">
            <p className="text-muted-foreground">Créditos</p>
            <p className="font-medium text-foreground">{order.credits_amount}</p>
          </div>
          <div className="rounded-md border border-border/70 bg-background/60 p-2">
            <p className="text-muted-foreground">Validade</p>
            <p className="font-medium text-foreground">{order.validity_days} dias</p>
          </div>
          <div className="rounded-md border border-border/70 bg-background/60 p-2">
            <p className="text-muted-foreground">Valor</p>
            <p className="font-medium text-foreground">{formatCurrencyBRL(order.price_amount_cents)}</p>
          </div>
          <div className="rounded-md border border-border/70 bg-background/60 p-2">
            <p className="text-muted-foreground">Criado em</p>
            <p className="font-medium text-foreground">{formatDateTimeBR(order.created_at)}</p>
          </div>
          <div className="rounded-md border border-border/70 bg-background/60 p-2">
            <p className="text-muted-foreground">Forma de pagamento</p>
            <p className="font-medium text-foreground">{getPaymentMethodLabel(order.payment_method)}</p>
          </div>
          {order.currency && (
            <div className="rounded-md border border-border/70 bg-background/60 p-2">
              <p className="text-muted-foreground">Moeda</p>
              <p className="font-medium uppercase text-foreground">{order.currency}</p>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
        <h2 className="font-display text-sm uppercase tracking-wider">Pagar com Stripe</h2>
        <p className="text-sm text-muted-foreground">
          Você será redirecionado para o ambiente seguro do Stripe para concluir o pagamento.
        </p>

        {canStartStripeCheckout ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              className="w-full sm:w-auto"
              onClick={() => createStripeCheckoutMutation.mutate()}
              disabled={createStripeCheckoutMutation.isPending}
            >
              {createStripeCheckoutMutation.isPending ? 'Redirecionando...' : 'Ir para checkout seguro'}
            </Button>
            {order.stripe_checkout_url && (
              <Button
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => {
                  if (!order.stripe_checkout_url) return;
                  window.location.href = order.stripe_checkout_url;
                }}
              >
                Retomar último checkout
              </Button>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Este pedido não está disponível para novo checkout.</p>
        )}

        {order.last_payment_error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            Falha anterior de pagamento: {order.last_payment_error}
          </div>
        )}

        <div className="rounded-lg border border-border/70 bg-background/80 p-3 text-xs text-muted-foreground">
          Segurança: valor e itens são recalculados no backend antes de criar a sessão. O status final do pedido vem do webhook do Stripe.
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button variant="outline" onClick={() => navigate('/plans/orders')}>
          Ver pedidos em andamento
        </Button>
        <Button variant="ghost" onClick={() => navigate('/plans')}>
          Voltar para planos
        </Button>
      </div>
    </div>
  );
};

export default PlanCheckoutPage;

