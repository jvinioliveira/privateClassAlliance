import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { CreditCard, Copy, QrCode, Wallet } from 'lucide-react';
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
  pix_code: string | null;
  pix_qr_image_url: string | null;
  credit_payment_url: string | null;
};

const getStatusVariant = (status: PlanOrderStatus): 'default' | 'secondary' | 'destructive' | 'outline' => {
  if (status === 'approved') return 'default';
  if (status === 'awaiting_approval') return 'secondary';
  if (status === 'cancelled') return 'destructive';
  return 'outline';
};

const PlanCheckoutPage = () => {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

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

      const needsPlanFallback =
        (!orderData.pix_code && !orderData.pix_qr_image_url) || !orderData.credit_payment_url;

      if (!needsPlanFallback) return orderData;

      const { data: planData, error: planError } = await supabase
        .from('lesson_plans')
        .select('pix_code, pix_qr_image_url, credit_payment_url')
        .eq('id', orderData.plan_id)
        .maybeSingle();

      if (planError) return orderData;
      const paymentConfig = (planData as PlanPaymentConfig | null) ?? null;
      if (!paymentConfig) return orderData;

      return {
        ...orderData,
        pix_code: orderData.pix_code || paymentConfig.pix_code,
        pix_qr_image_url: orderData.pix_qr_image_url || paymentConfig.pix_qr_image_url,
        credit_payment_url: orderData.credit_payment_url || paymentConfig.credit_payment_url,
      } as PlanOrder;
    },
    enabled: !!orderId && !!user,
  });

  const markPaymentMutation = useMutation({
    mutationFn: async (method: 'pix' | 'credit_link') => {
      if (!orderId) throw new Error('Pedido inválido.');
      const { error } = await supabase.rpc('mark_plan_order_payment', {
        p_order_id: orderId,
        p_payment_method: method,
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

  const handleCopyPix = async () => {
    if (!order?.pix_code) {
      toast.error('Código PIX ainda não configurado pelo professor.');
      return;
    }
    try {
      await navigator.clipboard.writeText(order.pix_code);
      toast.success('Código PIX copiado.');
    } catch {
      toast.error('Não foi possível copiar automaticamente. Selecione e copie manualmente.');
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
          <h1 className="font-display text-lg uppercase tracking-wider">Escolha a forma de pagamento</h1>
          <Badge variant={getStatusVariant(order.status)}>{getPlanOrderStatusLabel(order.status)}</Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Seus créditos serão liberados somente após a confirmação manual do pagamento pelo professor.
        </p>
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
          <Wallet className="h-4 w-4 text-primary" />
          <h2 className="font-display text-sm uppercase tracking-wider">Pagamento via PIX</h2>
        </div>

        <div className="space-y-2">
          <div className="rounded-lg border border-border bg-background/60 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Código copia e cola</p>
            <p className="mt-1 break-all text-xs text-foreground">{order.pix_code || 'Código PIX será disponibilizado em breve.'}</p>
          </div>
          <Button variant="outline" onClick={handleCopyPix} className="w-full">
            <Copy className="mr-2 h-4 w-4" />
            Copiar código PIX
          </Button>
        </div>

        {order.pix_qr_image_url && (
          <div className="rounded-lg border border-border bg-background/60 p-3">
            <div className="mb-2 flex items-center gap-2">
              <QrCode className="h-4 w-4 text-primary" />
              <p className="text-xs uppercase tracking-wide text-muted-foreground">QR Code PIX</p>
            </div>
            <img src={order.pix_qr_image_url} alt="QR Code PIX" className="mx-auto max-h-60 w-auto rounded-md border border-border" />
          </div>
        )}

        <Button
          disabled={!canConfirmPayment || isFinalizationExpired || markPaymentMutation.isPending}
          onClick={() => markPaymentMutation.mutate('pix')}
          className="w-full font-display uppercase tracking-wider"
        >
          {markPaymentMutation.isPending ? 'Confirmando...' : 'Já paguei via PIX'}
        </Button>
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-primary" />
          <h2 className="font-display text-sm uppercase tracking-wider">Pagamento com cartão</h2>
        </div>

        {order.credit_payment_url ? (
          <>
            <Button asChild variant="outline" className="w-full">
              <a href={order.credit_payment_url} target="_blank" rel="noreferrer">
                Pagar com cartão
              </a>
            </Button>
            <Button
              disabled={!canConfirmPayment || isFinalizationExpired || markPaymentMutation.isPending}
              onClick={() => markPaymentMutation.mutate('credit_link')}
              className="w-full font-display uppercase tracking-wider"
            >
              {markPaymentMutation.isPending ? 'Confirmando...' : 'Já paguei com cartão'}
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">O link de cartão ainda não foi configurado para este plano.</p>
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
