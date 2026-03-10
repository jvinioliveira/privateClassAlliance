import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import {
  formatCurrencyBRL,
  formatDateTimeBR,
  getClassTypeLabel,
  getPaymentMethodLabel,
  getPlanOrderStatusLabel,
  type PlanOrder,
  type PlanOrderStatus,
} from '@/lib/plan-orders';

type OrderWithNames = PlanOrder & {
  studentName: string;
  approverName: string | null;
};

const statusFilters: Array<{ value: 'all' | PlanOrderStatus; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'pending_payment', label: 'Aguardando pagamento' },
  { value: 'awaiting_approval', label: 'Aguardando aprovação' },
  { value: 'awaiting_contact', label: 'Aguardando contato' },
  { value: 'approved', label: 'Aprovados' },
  { value: 'cancelled', label: 'Cancelados' },
];

const getStatusVariant = (status: PlanOrderStatus): 'default' | 'secondary' | 'destructive' | 'outline' => {
  if (status === 'approved') return 'default';
  if (status === 'awaiting_approval' || status === 'awaiting_contact') return 'secondary';
  if (status === 'cancelled') return 'destructive';
  return 'outline';
};

const getDisplayName = (raw: { first_name: string | null; full_name: string | null } | undefined) => {
  if (!raw) return 'Aluno';
  const first = (raw.first_name || '').trim();
  if (first) return first;
  const full = (raw.full_name || '').trim();
  if (!full) return 'Aluno';
  return full.split(' ')[0] || 'Aluno';
};

const AdminPlanOrdersPage = () => {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<'all' | PlanOrderStatus>('all');
  const [notesByOrder, setNotesByOrder] = useState<Record<string, string>>({});

  const { data: orders = [], isLoading, isError } = useQuery<OrderWithNames[]>({
    queryKey: ['admin-plan-orders'],
    queryFn: async () => {
      await supabase.rpc('expire_stale_plan_orders', { p_user_id: null });

      const { data: ordersData, error: ordersError } = await supabase
        .from('plan_orders')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(300);

      if (ordersError) throw ordersError;

      const rawOrders = (ordersData ?? []) as PlanOrder[];
      const profileIds = Array.from(
        new Set(rawOrders.flatMap((order) => [order.user_id, order.approved_by].filter(Boolean) as string[])),
      );

      let profileById = new Map<string, { first_name: string | null; full_name: string | null }>();
      if (profileIds.length > 0) {
        const { data: profilesData, error: profilesError } = await supabase
          .from('profiles')
          .select('id, first_name, full_name')
          .in('id', profileIds);

        if (profilesError) throw profilesError;

        profileById = new Map(
          (profilesData ?? []).map((profile) => [
            profile.id,
            { first_name: profile.first_name ?? null, full_name: profile.full_name ?? null },
          ]),
        );
      }

      return rawOrders.map((order) => ({
        ...order,
        studentName: getDisplayName(profileById.get(order.user_id)),
        approverName: order.approved_by ? getDisplayName(profileById.get(order.approved_by)) : null,
      }));
    },
  });

  const filteredOrders = useMemo(() => {
    if (statusFilter === 'all') return orders;
    return orders.filter((order) => order.status === statusFilter);
  }, [orders, statusFilter]);

  const reviewMutation = useMutation({
    mutationFn: async ({
      orderId,
      decision,
      notes,
    }: {
      orderId: string;
      decision: 'approve' | 'cancel';
      notes?: string;
    }) => {
      const { error } = await supabase.rpc('review_plan_order', {
        p_order_id: orderId,
        p_decision: decision,
        p_admin_notes: notes?.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      toast.success(variables.decision === 'approve' ? 'Pedido aprovado e créditos liberados.' : 'Pedido cancelado.');
      queryClient.invalidateQueries({ queryKey: ['admin-plan-orders'] });
      queryClient.invalidateQueries({ queryKey: ['credit-summary'] });
      queryClient.invalidateQueries({ queryKey: ['student-home', 'credit-summary'] });
      queryClient.invalidateQueries({ queryKey: ['credit-purchase-history'] });
      queryClient.invalidateQueries({ queryKey: ['student-open-plan-orders'] });
      setNotesByOrder((prev) => {
        const next = { ...prev };
        delete next[variables.orderId];
        return next;
      });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleDecision = (orderId: string, decision: 'approve' | 'cancel') => {
    const notes = notesByOrder[orderId] || '';
    reviewMutation.mutate({ orderId, decision, notes });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <h1 className="font-display text-xl uppercase tracking-wider">Pedidos de compra</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Aprove ou cancele manualmente. Os créditos só entram para o aluno após aprovação.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {statusFilters.map((item) => (
          <Button
            key={item.value}
            type="button"
            variant={statusFilter === item.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStatusFilter(item.value)}
          >
            {item.label}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-destructive/50 bg-card p-4 text-sm text-destructive">
          Não foi possível carregar os pedidos.
        </div>
      ) : filteredOrders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Nenhum pedido para o filtro selecionado.
        </div>
      ) : (
        <div className="space-y-3">
          {filteredOrders.map((order) => {
            const isTerminal = order.status === 'approved' || order.status === 'cancelled';
            const isWorking = reviewMutation.isPending && reviewMutation.variables?.orderId === order.id;
            const canApprove =
              (order.plan_type === 'fixed' && order.status === 'awaiting_approval') ||
              (order.plan_type === 'custom' && (order.status === 'awaiting_contact' || order.status === 'awaiting_approval'));
            return (
              <div key={order.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-medium text-foreground">{order.plan_name}</p>
                      <Badge variant={getStatusVariant(order.status)}>{getPlanOrderStatusLabel(order.status)}</Badge>
                      <Badge variant="outline">{order.plan_type === 'fixed' ? 'Plano fixo' : 'Personalizado'}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Aluno: <span className="font-medium text-foreground">{order.studentName}</span>
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">{formatDateTimeBR(order.created_at)}</p>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:text-sm">
                  <div className="rounded-md border border-border/70 bg-background/60 p-2">
                    <p className="text-muted-foreground">Tipo de aula</p>
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
                    <p className="text-muted-foreground">Forma de pagamento</p>
                    <p className="font-medium text-foreground">{getPaymentMethodLabel(order.payment_method)}</p>
                  </div>
                  <div className="rounded-md border border-border/70 bg-background/60 p-2">
                    <p className="text-muted-foreground">Quantidade customizada</p>
                    <p className="font-medium text-foreground">{order.custom_quantity ?? '-'}</p>
                  </div>
                </div>

                {order.admin_notes && (
                  <div className="mt-3 rounded-md border border-border/70 bg-background/60 p-2 text-xs text-muted-foreground">
                    Observação atual: {order.admin_notes}
                  </div>
                )}

                {order.approverName && order.approved_at && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Revisado por {order.approverName} em {formatDateTimeBR(order.approved_at)}.
                  </p>
                )}

                {!isTerminal && (
                  <div className="mt-4 space-y-2">
                    <div className="space-y-1">
                      <Label htmlFor={`note-${order.id}`}>Observação do professor (opcional)</Label>
                      <Input
                        id={`note-${order.id}`}
                        value={notesByOrder[order.id] ?? ''}
                        onChange={(event) =>
                          setNotesByOrder((prev) => ({
                            ...prev,
                            [order.id]: event.target.value,
                          }))
                        }
                        placeholder="Ex.: comprovante confirmado"
                        className="bg-background"
                      />
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Button
                        onClick={() => handleDecision(order.id, 'approve')}
                        disabled={isWorking || !canApprove}
                        className="w-full font-display uppercase tracking-wider sm:w-auto"
                      >
                        {isWorking && reviewMutation.variables?.decision === 'approve' ? 'Aprovando...' : 'Aprovar e creditar'}
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={() => handleDecision(order.id, 'cancel')}
                        disabled={isWorking}
                        className="w-full font-display uppercase tracking-wider sm:w-auto"
                      >
                        {isWorking && reviewMutation.variables?.decision === 'cancel' ? 'Cancelando...' : 'Cancelar pedido'}
                      </Button>
                    </div>
                    {!canApprove && (
                      <p className="text-xs text-muted-foreground">
                        Aprovação disponível somente após o aluno informar pagamento (plano fixo) ou após contato confirmado (plano personalizado).
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AdminPlanOrdersPage;
