import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import {
  formatCountdown,
  formatCurrencyBRL,
  formatDateTimeBR,
  getClassTypeLabel,
  getOrderRemainingMs,
  getPaymentMethodLabel,
  getPlanOrderStatusLabel,
  type PlanOrder,
  type PlanOrderStatus,
} from '@/lib/plan-orders';

const openStatuses: PlanOrderStatus[] = ['pending_payment', 'awaiting_contact', 'awaiting_approval'];

const getStatusVariant = (status: PlanOrderStatus): 'default' | 'secondary' | 'destructive' | 'outline' => {
  if (status === 'approved') return 'default';
  if (status === 'awaiting_approval' || status === 'awaiting_contact') return 'secondary';
  if (status === 'cancelled') return 'destructive';
  return 'outline';
};

const PlanOrdersPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  const { data: orders = [], isLoading, isError } = useQuery({
    queryKey: ['student-open-plan-orders', user?.id],
    queryFn: async () => {
      if (!user) return [] as PlanOrder[];

      await supabase.rpc('expire_stale_plan_orders', { p_user_id: user.id });

      const { data, error } = await supabase
        .from('plan_orders')
        .select('*')
        .eq('user_id', user.id)
        .in('status', openStatuses)
        .order('created_at', { ascending: false })
        .limit(30);

      if (error) throw error;
      return (data ?? []) as PlanOrder[];
    },
    enabled: !!user,
  });

  const ordersWithCountdown = useMemo(
    () =>
      orders.map((order) => ({
        ...order,
        remainingMs: getOrderRemainingMs(order, nowMs),
      })),
    [orders, nowMs],
  );

  return (
    <div className="space-y-4 p-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <h1 className="font-display text-lg uppercase tracking-wider">Pedidos em andamento</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Se você fechar a aba durante a compra, volte aqui para continuar de onde parou.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-destructive/40 bg-card p-4 text-sm text-destructive">
          Não foi possível carregar seus pedidos.
        </div>
      ) : ordersWithCountdown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">Você não tem pedidos em andamento no momento.</p>
          <Button className="mt-3" onClick={() => navigate('/plans')}>
            Ir para planos
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {ordersWithCountdown.map((order) => {
            const isExpired = order.remainingMs !== null && order.remainingMs <= 0;
            return (
              <div key={order.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{order.plan_name}</p>
                  <Badge variant={getStatusVariant(order.status)}>{getPlanOrderStatusLabel(order.status)}</Badge>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:text-sm">
                  <div className="rounded-md border border-border/70 bg-background/60 p-2">
                    <p className="text-muted-foreground">Tipo</p>
                    <p className="font-medium text-foreground">{getClassTypeLabel(order.class_type)}</p>
                  </div>
                  <div className="rounded-md border border-border/70 bg-background/60 p-2">
                    <p className="text-muted-foreground">Créditos</p>
                    <p className="font-medium text-foreground">{order.credits_amount}</p>
                  </div>
                  <div className="rounded-md border border-border/70 bg-background/60 p-2">
                    <p className="text-muted-foreground">Valor</p>
                    <p className="font-medium text-foreground">{formatCurrencyBRL(order.price_amount_cents)}</p>
                  </div>
                  <div className="rounded-md border border-border/70 bg-background/60 p-2">
                    <p className="text-muted-foreground">Pagamento</p>
                    <p className="font-medium text-foreground">{getPaymentMethodLabel(order.payment_method)}</p>
                  </div>
                  <div className="rounded-md border border-border/70 bg-background/60 p-2">
                    <p className="text-muted-foreground">Criado em</p>
                    <p className="font-medium text-foreground">{formatDateTimeBR(order.created_at)}</p>
                  </div>
                  {order.remainingMs !== null && (
                    <div className="rounded-md border border-border/70 bg-background/60 p-2">
                      <p className="text-muted-foreground">Tempo restante</p>
                      <p className="font-medium text-foreground">{isExpired ? 'Encerrado' : formatCountdown(order.remainingMs)}</p>
                    </div>
                  )}
                </div>

                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <Button
                    className="w-full sm:w-auto"
                    onClick={() => navigate(`/plans/checkout/${order.id}`)}
                  >
                    Retomar checkout
                  </Button>
                  <Button variant="outline" className="w-full sm:w-auto" onClick={() => navigate('/plans')}>
                    Fazer novo pedido
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PlanOrdersPage;
