import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
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
type PaymentAttemptRow = Database['public']['Tables']['plan_order_payment_attempts']['Row'];

const PAGE_SIZE = 5;

const filterOptions: Array<{ value: PlanOrderStatus; label: string }> = [
  { value: 'pending_payment', label: 'Aguardando pagamento' },
  { value: 'awaiting_approval', label: 'Pagamento confirmado' },
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

const getDisplayName = (
  raw: { first_name: string | null; last_name: string | null; full_name: string | null } | undefined,
) => {
  if (!raw) return 'Aluno';
  const full = (raw.full_name || '').trim();
  if (full) return full;

  const first = (raw.first_name || '').trim();
  const last = (raw.last_name || '').trim();
  const combined = `${first} ${last}`.trim();
  if (combined) return combined;
  if (first) return first;
  return 'Aluno';
};

const getListItemClassName = (status: PlanOrderStatus) => {
  if (status === 'approved') return 'border-green-500/50 bg-green-500/10';
  if (status === 'awaiting_approval') return 'border-emerald-500/40 bg-emerald-500/5';
  if (status === 'cancelled') return 'border-red-500/50 bg-red-500/10';
  return 'border-border bg-card';
};

const getStatusBadgeClassName = (status: PlanOrderStatus) => {
  if (status === 'approved') return 'bg-green-600 text-white hover:bg-green-600';
  return '';
};

const getAttemptProviderLabel = (provider: string) => {
  if (provider === 'nupay') return 'Outro';
  if (provider === 'stripe') return 'Stripe';
  return provider;
};

const AdminPlanOrdersPage = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedStatuses, setSelectedStatuses] = useState<PlanOrderStatus[]>(filterOptions.map((item) => item.value));
  const [currentPage, setCurrentPage] = useState(0);
  const [selectedOrder, setSelectedOrder] = useState<OrderWithNames | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const normalizedStatusFilterKey = useMemo(() => [...selectedStatuses].sort().join(','), [selectedStatuses]);

  const { data, isLoading, isError } = useQuery<{ orders: OrderWithNames[]; totalCount: number }>({
    queryKey: ['admin-plan-orders', normalizedStatusFilterKey, currentPage],
    queryFn: async () => {
      await supabase.rpc('expire_stale_plan_orders', { p_user_id: null });

      const { data: ordersData, error: ordersError, count } = await supabase
        .from('plan_orders')
        .select('*', { count: 'exact' })
        .in('status', selectedStatuses)
        .order('created_at', { ascending: false })
        .range(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE - 1);

      if (ordersError) throw ordersError;

      const rawOrders = (ordersData ?? []) as PlanOrder[];
      const profileIds = Array.from(
        new Set(rawOrders.flatMap((order) => [order.user_id, order.approved_by].filter(Boolean) as string[])),
      );

      let profileById = new Map<string, { first_name: string | null; last_name: string | null; full_name: string | null }>();
      if (profileIds.length > 0) {
        const { data: profilesData, error: profilesError } = await supabase
          .from('profiles')
          .select('id, first_name, last_name, full_name')
          .in('id', profileIds);

        if (profilesError) throw profilesError;

        profileById = new Map(
          (profilesData ?? []).map((profile) => [
            profile.id,
            {
              first_name: profile.first_name ?? null,
              last_name: profile.last_name ?? null,
              full_name: profile.full_name ?? null,
            },
          ]),
        );
      }

      const mappedOrders = rawOrders.map((order) => ({
        ...order,
        studentName: getDisplayName(profileById.get(order.user_id)),
        approverName: order.approved_by ? getDisplayName(profileById.get(order.approved_by)) : null,
      }));

      return {
        orders: mappedOrders,
        totalCount: count ?? 0,
      };
    },
    placeholderData: (previous) => previous,
  });

  const paginatedOrders = data?.orders ?? [];
  const totalCount = data?.totalCount ?? 0;
  const totalPages = Math.max(Math.ceil(totalCount / PAGE_SIZE), 1);

  useEffect(() => {
    if (currentPage > totalPages - 1) {
      setCurrentPage(Math.max(totalPages - 1, 0));
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    if (!user) return;

    const markAdminOrderNotificationsAsRead = async () => {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('user_id', user.id)
        .eq('type', 'plan_order_new')
        .eq('read', false);

      if (!error) {
        queryClient.invalidateQueries({ queryKey: ['admin-plan-order-unread', user.id] });
      }
    };

    void markAdminOrderNotificationsAsRead();
  }, [user, queryClient]);

  const reviewMutation = useMutation({
    mutationFn: async ({ orderId }: { orderId: string }) => {
      const { error } = await supabase.rpc('review_plan_order', {
        p_order_id: orderId,
        p_decision: 'cancel',
        p_admin_notes: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Pedido cancelado.');
      queryClient.invalidateQueries({ queryKey: ['admin-plan-orders'] });
      queryClient.invalidateQueries({ queryKey: ['admin-plan-order-unread'] });
      queryClient.invalidateQueries({ queryKey: ['credit-summary'] });
      queryClient.invalidateQueries({ queryKey: ['student-home', 'credit-summary'] });
      queryClient.invalidateQueries({ queryKey: ['credit-purchase-history'] });
      queryClient.invalidateQueries({ queryKey: ['student-open-plan-orders'] });
      setIsDetailsOpen(false);
      setSelectedOrder(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleDecision = (orderId: string) => {
    reviewMutation.mutate({ orderId });
  };

  const toggleStatusFilter = (status: PlanOrderStatus) => {
    setCurrentPage(0);
    setSelectedStatuses((prev) => {
      if (prev.includes(status)) {
        if (prev.length === 1) return prev;
        return prev.filter((item) => item !== status);
      }
      return [...prev, status];
    });
  };

  const openOrderDetails = (order: OrderWithNames) => {
    setSelectedOrder(order);
    setIsDetailsOpen(true);
  };

  const selectedOrderTerminal = selectedOrder?.status === 'approved' || selectedOrder?.status === 'cancelled';
  const isReviewingSelectedOrder = !!selectedOrder && reviewMutation.isPending;
  const { data: selectedOrderAttempts = [], isLoading: loadingSelectedOrderAttempts } = useQuery<PaymentAttemptRow[]>({
    queryKey: ['admin-plan-order-payment-attempts', selectedOrder?.id],
    queryFn: async () => {
      if (!selectedOrder) return [];

      const { data, error } = await supabase
        .from('plan_order_payment_attempts')
        .select('*')
        .eq('order_id', selectedOrder.id)
        .order('attempted_at', { ascending: false })
        .limit(30);

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!selectedOrder && isDetailsOpen,
  });

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <h1 className="font-display text-xl uppercase tracking-wider">Pedidos de compra</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Acompanhe o status financeiro e a auditoria dos pedidos. Pedidos pagos no Stripe são creditados automaticamente.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">Filtrar status ({selectedStatuses.length})</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel>Selecione os status</DropdownMenuLabel>
            {filterOptions.map((option) => (
              <DropdownMenuCheckboxItem
                key={option.value}
                checked={selectedStatuses.includes(option.value)}
                onCheckedChange={() => toggleStatusFilter(option.value)}
              >
                {option.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="text-xs text-muted-foreground">
          Mostrando {paginatedOrders.length} de {totalCount} pedidos
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-destructive/50 bg-card p-4 text-sm text-destructive">
          NÃ£o foi possÃ­vel carregar os pedidos.
        </div>
      ) : paginatedOrders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
          Nenhum pedido para os filtros selecionados.
        </div>
      ) : (
        <div className="space-y-2">
          {paginatedOrders.map((order) => (
            <button
              key={order.id}
              type="button"
              onClick={() => openOrderDetails(order)}
              className={`w-full rounded-xl border p-4 text-left transition-colors ${getListItemClassName(order.status)}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-foreground">{order.studentName}</p>
                  <p className="text-xs text-muted-foreground">{order.plan_name}</p>
                </div>
                <Badge variant={getStatusVariant(order.status)} className={getStatusBadgeClassName(order.status)}>
                  {getPlanOrderStatusLabel(order.status)}
                </Badge>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <div className="rounded-md border border-border/60 bg-background/60 p-2">
                  <p className="text-muted-foreground">Valor</p>
                  <p className="font-medium text-foreground">{formatCurrencyBRL(order.price_amount_cents)}</p>
                </div>
                <div className="rounded-md border border-border/60 bg-background/60 p-2">
                  <p className="text-muted-foreground">Pagamento</p>
                  <p className="font-medium text-foreground">{getPaymentMethodLabel(order.payment_method)}</p>
                </div>
                <div className="rounded-md border border-border/60 bg-background/60 p-2">
                  <p className="text-muted-foreground">Tipo</p>
                  <p className="font-medium text-foreground">{order.plan_type === 'fixed' ? 'Fixo' : 'Personalizado'}</p>
                </div>
                <div className="rounded-md border border-border/60 bg-background/60 p-2">
                  <p className="text-muted-foreground">Data</p>
                  <p className="font-medium text-foreground">{formatDateTimeBR(order.created_at)}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 0))}
          disabled={currentPage === 0}
        >
          Anterior
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages - 1))}
          disabled={currentPage >= totalPages - 1}
        >
          PrÃ³xima
        </Button>
      </div>

      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto border-border bg-card sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="font-display uppercase tracking-wider">Detalhes do pedido</DialogTitle>
          </DialogHeader>

          {!selectedOrder ? (
            <p className="text-sm text-muted-foreground">Selecione um pedido para visualizar.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-base font-medium text-foreground">{selectedOrder.studentName}</p>
                <Badge variant={getStatusVariant(selectedOrder.status)} className={getStatusBadgeClassName(selectedOrder.status)}>
                  {getPlanOrderStatusLabel(selectedOrder.status)}
                </Badge>
                <Badge variant="outline">{selectedOrder.plan_type === 'fixed' ? 'Plano fixo' : 'Personalizado'}</Badge>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs sm:text-sm">
                <div className="rounded-md border border-border/70 bg-background/60 p-2">
                  <p className="text-muted-foreground">Plano</p>
                  <p className="font-medium text-foreground">{selectedOrder.plan_name}</p>
                </div>
                <div className="rounded-md border border-border/70 bg-background/60 p-2">
                  <p className="text-muted-foreground">Tipo de aula</p>
                  <p className="font-medium text-foreground">{getClassTypeLabel(selectedOrder.class_type)}</p>
                </div>
                <div className="rounded-md border border-border/70 bg-background/60 p-2">
                  <p className="text-muted-foreground">CrÃ©ditos</p>
                  <p className="font-medium text-foreground">{selectedOrder.credits_amount}</p>
                </div>
                <div className="rounded-md border border-border/70 bg-background/60 p-2">
                  <p className="text-muted-foreground">Validade</p>
                  <p className="font-medium text-foreground">{selectedOrder.validity_days} dias</p>
                </div>
                <div className="rounded-md border border-border/70 bg-background/60 p-2">
                  <p className="text-muted-foreground">Valor</p>
                  <p className="font-medium text-foreground">{formatCurrencyBRL(selectedOrder.price_amount_cents)}</p>
                </div>
                <div className="rounded-md border border-border/70 bg-background/60 p-2">
                  <p className="text-muted-foreground">Forma de pagamento</p>
                  <p className="font-medium text-foreground">{getPaymentMethodLabel(selectedOrder.payment_method)}</p>
                </div>
                <div className="rounded-md border border-border/70 bg-background/60 p-2">
                  <p className="text-muted-foreground">CrÃ©dito concedido em</p>
                  <p className="font-medium text-foreground">
                    {selectedOrder.credits_granted_at ? formatDateTimeBR(selectedOrder.credits_granted_at) : '-'}
                  </p>
                </div>
                {selectedOrder.stripe_payment_status && (
                  <div className="rounded-md border border-border/70 bg-background/60 p-2">
                    <p className="text-muted-foreground">Status Stripe</p>
                    <p className="font-medium uppercase text-foreground">{selectedOrder.stripe_payment_status}</p>
                  </div>
                )}
                {selectedOrder.requires_refund_review && (
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2">
                    <p className="text-muted-foreground">RevisÃ£o de estorno</p>
                    <p className="font-medium text-amber-700">{selectedOrder.refund_review_reason || 'Pendente'}</p>
                  </div>
                )}
                {selectedOrder.stripe_checkout_session_id && (
                  <div className="rounded-md border border-border/70 bg-background/60 p-2">
                    <p className="text-muted-foreground">Checkout Session</p>
                    <p className="truncate font-medium text-foreground">{selectedOrder.stripe_checkout_session_id}</p>
                  </div>
                )}
                <div className="rounded-md border border-border/70 bg-background/60 p-2">
                  <p className="text-muted-foreground">Criado em</p>
                  <p className="font-medium text-foreground">{formatDateTimeBR(selectedOrder.created_at)}</p>
                </div>
                <div className="rounded-md border border-border/70 bg-background/60 p-2">
                  <p className="text-muted-foreground">Quantidade customizada</p>
                  <p className="font-medium text-foreground">{selectedOrder.custom_quantity ?? '-'}</p>
                </div>
              </div>

              <div className="rounded-lg border border-border/70 bg-background/50 p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Auditoria de tentativas de pagamento</p>
                {loadingSelectedOrderAttempts ? (
                  <p className="mt-2 text-xs text-muted-foreground">Carregando tentativas...</p>
                ) : selectedOrderAttempts.length === 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">Nenhuma tentativa registrada atÃ© o momento.</p>
                ) : (
                  <div className="mt-2 space-y-2">
                    {selectedOrderAttempts.map((attempt) => (
                      <div key={attempt.id} className="rounded-md border border-border/60 bg-background/70 p-2">
                        <p className="text-xs font-medium text-foreground">
                          {getAttemptProviderLabel(attempt.provider)} â€¢{' '}
                          {attempt.event_name === 'checkout_opened'
                            ? 'Checkout aberto'
                            : attempt.event_name === 'checkout_redirected'
                            ? 'Checkout redirecionado'
                            : attempt.event_name}
                        </p>
                        <p className="text-[11px] text-muted-foreground">{formatDateTimeBR(attempt.attempted_at)}</p>
                        {attempt.user_agent && (
                          <p className="mt-1 line-clamp-2 break-all text-[10px] text-muted-foreground">{attempt.user_agent}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {selectedOrder.approverName && selectedOrder.approved_at && (
                <p className="text-xs text-muted-foreground">
                  Revisado por {selectedOrder.approverName} em {formatDateTimeBR(selectedOrder.approved_at)}.
                </p>
              )}

              {!selectedOrderTerminal && (
                <div className="space-y-2">
                  <Button
                    variant="destructive"
                    onClick={() => handleDecision(selectedOrder.id)}
                    disabled={isReviewingSelectedOrder}
                    className="w-full font-display uppercase tracking-wider sm:w-auto"
                  >
                    {isReviewingSelectedOrder ? 'Cancelando...' : 'Cancelar pedido'}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    CrÃ©ditos sÃ£o liberados automaticamente pelo webhook da Stripe apÃ³s pagamento confirmado.
                  </p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminPlanOrdersPage;



