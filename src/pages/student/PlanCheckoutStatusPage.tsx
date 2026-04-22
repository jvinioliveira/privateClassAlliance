import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Clock3, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  formatCurrencyBRL,
  formatDateTimeBR,
  getPlanOrderStatusLabel,
  type PlanOrder,
  type PlanOrderStatus,
} from '@/lib/plan-orders';

type CheckoutState = 'success' | 'cancel' | 'pending' | 'error';

const getStateFromPath = (pathname: string): CheckoutState => {
  if (pathname.endsWith('/success')) return 'success';
  if (pathname.endsWith('/cancel')) return 'cancel';
  if (pathname.endsWith('/pending')) return 'pending';
  return 'error';
};

const getStatusVariant = (status: PlanOrderStatus): 'default' | 'secondary' | 'destructive' | 'outline' => {
  if (status === 'approved') return 'default';
  if (status === 'awaiting_approval') return 'secondary';
  if (status === 'cancelled') return 'destructive';
  return 'outline';
};

const PlanCheckoutStatusPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();

  const orderId = searchParams.get('orderId');
  const sessionId = searchParams.get('session_id');
  const state = getStateFromPath(location.pathname);

  const { data: order, isLoading } = useQuery({
    queryKey: ['checkout-return-order', orderId, user?.id],
    queryFn: async () => {
      if (!orderId || !user) return null;

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
    refetchInterval: 8000,
  });

  const ui = useMemo(() => {
    const liveStatus = order?.status;

    if (liveStatus === 'approved') {
      return {
        icon: CheckCircle2,
        title: 'Compra aprovada',
        message: 'Pagamento confirmado e créditos liberados com sucesso.',
        tone: 'success' as const,
      };
    }

    if (liveStatus === 'awaiting_approval') {
      return {
        icon: Clock3,
        title: 'Pagamento confirmado',
        message: 'Seu pagamento foi recebido. Os créditos serão liberados automaticamente em instantes.',
        tone: 'pending' as const,
      };
    }

    if (liveStatus === 'cancelled') {
      return {
        icon: XCircle,
        title: 'Pedido cancelado',
        message: 'Este pedido foi cancelado. Você pode gerar um novo checkout a partir dos planos.',
        tone: 'cancel' as const,
      };
    }

    if (order?.duplicate_payment_detected || order?.requires_refund_review) {
      return {
        icon: AlertCircle,
        title: 'Pagamento em revisão',
        message: 'Detectamos uma situação de pagamento que requer validação. Nosso time já foi notificado.',
        tone: 'error' as const,
      };
    }

    if (state === 'success') {
      return {
        icon: Clock3,
        title: 'Pagamento em processamento',
        message: 'Recebemos seu retorno do checkout. Aguarde alguns instantes para atualizar o status.',
        tone: 'pending' as const,
      };
    }

    if (state === 'cancel') {
      return {
        icon: XCircle,
        title: 'Pagamento cancelado',
        message: 'Nenhuma cobrança foi concluída. Você pode retomar o checkout quando quiser.',
        tone: 'cancel' as const,
      };
    }

    if (state === 'pending') {
      return {
        icon: Clock3,
        title: 'Pagamento pendente',
        message: 'Seu pagamento ainda está pendente de confirmação pelo provedor.',
        tone: 'pending' as const,
      };
    }

    return {
      icon: AlertCircle,
      title: 'Erro ao confirmar pagamento',
      message: 'Não conseguimos validar o retorno do pagamento. Retome o pedido ou fale com o suporte.',
      tone: 'error' as const,
    };
  }, [order?.duplicate_payment_detected, order?.requires_refund_review, order?.status, state]);

  const toneClass =
    ui.tone === 'success'
      ? 'border-green-500/40 bg-green-500/10 text-green-700'
      : ui.tone === 'cancel'
      ? 'border-destructive/40 bg-destructive/5 text-destructive'
      : ui.tone === 'error'
      ? 'border-amber-500/40 bg-amber-500/10 text-amber-700'
      : 'border-primary/40 bg-primary/5 text-primary';

  useEffect(() => {
    if (!orderId || !user?.id) return;

    const attemptKey = `stripe-return-attempt:${user.id}:${orderId}:${sessionId || 'no-session'}`;
    if (typeof window !== 'undefined' && window.sessionStorage.getItem(attemptKey) === '1') return;

    supabase
      .from('plan_order_payment_attempts')
      .insert({
        order_id: orderId,
        user_id: user.id,
        provider: 'stripe',
        event_name: 'checkout_returned',
        user_agent: typeof window !== 'undefined' ? window.navigator.userAgent : null,
      })
      .then(() => {
        if (typeof window !== 'undefined') {
          window.sessionStorage.setItem(attemptKey, '1');
        }
      });
  }, [orderId, sessionId, user?.id]);

  const Icon = ui.icon;

  return (
    <div className="space-y-4 p-4">
      <div className={`rounded-xl border p-4 ${toneClass}`}>
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5" />
          <h1 className="font-display text-lg uppercase tracking-wider">{ui.title}</h1>
        </div>
        <p className="mt-2 text-sm">{ui.message}</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center p-8">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : order ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-sm uppercase tracking-wider">Pedido</h2>
            <Badge variant={getStatusVariant(order.status)}>{getPlanOrderStatusLabel(order.status)}</Badge>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:text-sm">
            <div className="rounded-md border border-border/70 bg-background/60 p-2">
              <p className="text-muted-foreground">Plano</p>
              <p className="font-medium text-foreground">{order.plan_name}</p>
            </div>
            <div className="rounded-md border border-border/70 bg-background/60 p-2">
              <p className="text-muted-foreground">Valor</p>
              <p className="font-medium text-foreground">{formatCurrencyBRL(order.price_amount_cents)}</p>
            </div>
            <div className="rounded-md border border-border/70 bg-background/60 p-2">
              <p className="text-muted-foreground">Criado em</p>
              <p className="font-medium text-foreground">{formatDateTimeBR(order.created_at)}</p>
            </div>
            {order.paid_at && (
              <div className="rounded-md border border-border/70 bg-background/60 p-2">
                <p className="text-muted-foreground">Pagamento em</p>
                <p className="font-medium text-foreground">{formatDateTimeBR(order.paid_at)}</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
          Pedido não encontrado para este retorno.
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        {order?.id && <Button onClick={() => navigate(`/plans/checkout/${order.id}`)}>Ver checkout do pedido</Button>}
        <Button variant="outline" onClick={() => navigate('/plans/orders')}>
          Ir para pedidos
        </Button>
        <Button variant="ghost" onClick={() => navigate('/plans')}>
          Ver planos
        </Button>
      </div>
    </div>
  );
};

export default PlanCheckoutStatusPage;
