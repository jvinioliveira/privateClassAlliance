import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { CreditCard } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  formatCurrencyBRL,
  formatCountdown,
  formatDateTimeBR,
  getClassTypeLabel,
  getOrderRemainingMs,
  getPlanOrderStatusLabel,
  isOrderFinalizableStatus,
  type PlanOrder,
  type PlanOrderStatus,
} from '@/lib/plan-orders';

type PlanPaymentConfig = {
  credit_payment_url: string | null;
};

type PaymentTimelineStep = {
  label: string;
};

const getStatusVariant = (status: PlanOrderStatus): 'default' | 'secondary' | 'destructive' | 'outline' => {
  if (status === 'approved') return 'default';
  if (status === 'awaiting_approval') return 'secondary';
  if (status === 'cancelled') return 'destructive';
  return 'outline';
};

const NubankIcon = () => (
  <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-[#820ad1] text-[11px] font-bold leading-none text-white">
    nu
  </span>
);

const paymentTimelineSteps: PaymentTimelineStep[] = [
  { label: 'Aguardando pagamento' },
  { label: 'Em análise' },
  { label: 'Aprovado' },
];

const PlanCheckoutPage = () => {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [nowMs, setNowMs] = useState(Date.now());
  const [hasOpenedNuPay, setHasOpenedNuPay] = useState(false);

  const localStorageKey = useMemo(() => {
    if (!orderId || !user?.id) return null;
    return `plan-order-nupay-opened:${user.id}:${orderId}`;
  }, [orderId, user?.id]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!localStorageKey || typeof window === 'undefined') return;
    const opened = window.localStorage.getItem(localStorageKey) === '1';
    setHasOpenedNuPay(opened);
  }, [localStorageKey]);

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
      const orderData = (data as PlanOrder | null) ?? null;

      if (!orderData || !orderData.plan_id) return orderData;
      if (orderData.credit_payment_url) return orderData;

      const { data: planData, error: planError } = await supabase
        .from('lesson_plans')
        .select('credit_payment_url')
        .eq('id', orderData.plan_id)
        .maybeSingle();

      if (planError) return orderData;
      const paymentConfig = (planData as PlanPaymentConfig | null) ?? null;
      if (!paymentConfig) return orderData;

      return {
        ...orderData,
        credit_payment_url: orderData.credit_payment_url || paymentConfig.credit_payment_url,
      } as PlanOrder;
    },
    enabled: !!orderId && !!user,
  });

  const markPaymentMutation = useMutation({
    mutationFn: async () => {
      if (!orderId) throw new Error('Pedido inválido.');
      const { error } = await supabase.rpc('mark_plan_order_payment', {
        p_order_id: orderId,
        p_payment_method: 'credit_link',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Pagamento informado. Agora aguarde a aprovação do professor.');
      queryClient.invalidateQueries({ queryKey: ['plan-order', orderId, user?.id] });
      queryClient.invalidateQueries({ queryKey: ['plan-orders'] });
      queryClient.invalidateQueries({ queryKey: ['student-open-plan-orders'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const registerAttemptMutation = useMutation({
    mutationFn: async () => {
      if (!orderId || !user?.id) return;

      const { error } = await supabase.from('plan_order_payment_attempts').insert({
        order_id: orderId,
        user_id: user.id,
        provider: 'nupay',
        event_name: 'checkout_opened',
        user_agent: typeof window !== 'undefined' ? window.navigator.userAgent : null,
      });

      if (error) throw error;
    },
    onError: () => {
      // Tentativa de auditoria não deve bloquear a experiência de pagamento.
    },
  });

  const statusMessage = useMemo(() => {
    if (!order) return null;
    if (order.status === 'approved') return 'Compra aprovada. Seus créditos já estão disponíveis.';
    if (order.status === 'cancelled') {
      if ((order.admin_notes || '').toLowerCase().includes('expiração do prazo de pagamento')) {
        return 'O prazo para pagamento expirou e este pedido foi cancelado automaticamente.';
      }
      return 'Este pedido foi cancelado. Entre em contato com o professor para suporte.';
    }
    if (order.status === 'awaiting_approval') return 'Pagamento informado. O professor fará a validação manual.';
    return 'Após o pagamento, o professor fará a confirmação manual da sua compra.';
  }, [order]);

  const canConfirmPayment = order?.status === 'pending_payment';
  const remainingMs = order ? getOrderRemainingMs(order, nowMs) : null;
  const isFinalizationExpired =
    !!order && remainingMs !== null && remainingMs <= 0 && isOrderFinalizableStatus(order.status);
  const paymentTimelineIndex = useMemo(() => {
    if (!order) return 0;

    if (order.status === 'approved') return 2;
    if (order.status === 'awaiting_approval') return 1;
    if (order.status === 'cancelled') {
      return order.payment_confirmed_at ? 1 : 0;
    }
    return 0;
  }, [order]);

  const handleOpenNuPay = () => {
    if (!order?.credit_payment_url) {
      toast.error('O link de pagamento NuPay ainda não foi configurado para este plano.');
      return;
    }

    if (localStorageKey && typeof window !== 'undefined') {
      window.localStorage.setItem(localStorageKey, '1');
      setHasOpenedNuPay(true);
    }

    registerAttemptMutation.mutate();

    const popup = window.open(order.credit_payment_url, '_blank', 'noopener,noreferrer');
    if (!popup) {
      window.location.href = order.credit_payment_url;
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center p-8">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (isError || !order || order.plan_type !== 'fixed') {
    return (
      <div className="space-y-4 p-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <h1 className="font-display text-lg uppercase tracking-wider">Pagamento do plano</h1>
          <p className="mt-2 text-sm text-muted-foreground">Pedido não encontrado para este fluxo.</p>
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
          <h1 className="font-display text-lg uppercase tracking-wider">Finalizar pagamento</h1>
          <Badge variant={getStatusVariant(order.status)}>{getPlanOrderStatusLabel(order.status)}</Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Seus créditos serão liberados somente após a confirmação manual do pagamento pelo professor.
        </p>
        <div className="mt-4 rounded-lg border border-border/70 bg-background/50 p-3">
          <p className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">Etapas do pagamento</p>
          <ol className="grid gap-2 sm:grid-cols-3">
            {paymentTimelineSteps.map((step, index) => {
              const isCompleted = index < paymentTimelineIndex;
              const isCurrent = index === paymentTimelineIndex;

              return (
                <li key={step.label} className="flex items-center gap-2">
                  <span
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-semibold ${
                      isCompleted
                        ? 'border-green-600 bg-green-600 text-white'
                        : isCurrent
                        ? 'border-primary bg-primary/15 text-primary'
                        : 'border-border bg-background text-muted-foreground'
                    }`}
                  >
                    {index + 1}
                  </span>
                  <div>
                    <p className={`text-xs ${isCurrent || isCompleted ? 'text-foreground' : 'text-muted-foreground'}`}>{step.label}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {isCompleted ? 'Concluída' : isCurrent ? 'Etapa atual' : 'Pendente'}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
          {order.status === 'cancelled' && (
            <p className="mt-3 text-xs text-destructive">Pedido cancelado. Crie um novo pedido para continuar.</p>
          )}
        </div>
        {remainingMs !== null && (
          <div className="mt-3 rounded-lg border border-primary/30 bg-primary/10 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Tempo para finalizar pedido</p>
            <p className="text-lg font-semibold text-foreground">
              {isFinalizationExpired ? 'Tempo encerrado' : formatCountdown(remainingMs)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {isFinalizationExpired
                ? 'Crie um novo pedido para continuar a compra.'
                : 'Se fechar a aba, você pode continuar depois na página de pedidos em andamento.'}
            </p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => navigate('/plans/orders')}>
              Ir para pedidos em andamento
            </Button>
          </div>
        )}
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
            <p className="text-muted-foreground">Valor total</p>
            <p className="font-medium text-foreground">{formatCurrencyBRL(order.price_amount_cents)}</p>
          </div>
          <div className="rounded-md border border-border/70 bg-background/60 p-2">
            <p className="text-muted-foreground">Criado em</p>
            <p className="font-medium text-foreground">{formatDateTimeBR(order.created_at)}</p>
          </div>
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <NubankIcon />
          <h2 className="font-display text-sm uppercase tracking-wider">Pagamento via NuPay (Nubank)</h2>
        </div>

        <div className="rounded-lg border border-[#820ad1]/20 bg-[#820ad1]/5 p-3">
          <p className="text-sm text-foreground">
            Toque no botão abaixo para abrir o checkout NuPay e pagar via PIX, cartão de crédito ou app Nubank.
          </p>
        </div>

        <Button
          onClick={handleOpenNuPay}
          disabled={!order.credit_payment_url || isFinalizationExpired}
          className="w-full bg-[#820ad1] text-white hover:bg-[#6f0bb8]"
        >
          <CreditCard className="mr-2 h-4 w-4" />
          Pagar com NuPay
        </Button>

        {hasOpenedNuPay && (
          <Button
            disabled={!canConfirmPayment || isFinalizationExpired || markPaymentMutation.isPending}
            onClick={() => markPaymentMutation.mutate()}
            className="w-full font-display uppercase tracking-wider"
          >
            {markPaymentMutation.isPending ? 'Confirmando...' : 'Já paguei'}
          </Button>
        )}

        {!hasOpenedNuPay && (
          <p className="text-xs text-muted-foreground">
            Após concluir no NuPay, volte para esta página para liberar o botão de confirmação do pagamento.
          </p>
        )}
      </div>

      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
        <p className="text-sm font-medium text-foreground">{statusMessage}</p>
        {order.admin_notes && <p className="mt-2 text-xs text-muted-foreground">Observação do professor: {order.admin_notes}</p>}
      </div>
    </div>
  );
};

export default PlanCheckoutPage;
