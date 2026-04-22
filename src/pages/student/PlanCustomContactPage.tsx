import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { MessageCircle, PhoneCall } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  formatCurrencyBRL,
  formatDateTimeBR,
  getClassTypeLabel,
  getPlanOrderStatusLabel,
  type PlanOrder,
  type PlanOrderStatus,
} from '@/lib/plan-orders';

const getStatusVariant = (status: PlanOrderStatus): 'default' | 'secondary' | 'destructive' | 'outline' => {
  if (status === 'approved') return 'default';
  if (status === 'awaiting_contact' || status === 'awaiting_approval') return 'secondary';
  if (status === 'cancelled') return 'destructive';
  return 'outline';
};

const sanitizePhone = (value: string) => value.replace(/\D/g, '');

const PlanCustomContactPage = () => {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  const { data: order, isLoading, isError } = useQuery({
    queryKey: ['plan-order', orderId, user?.id],
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
  });

  const studentName = useMemo(() => {
    const full = `${(profile?.first_name || '').trim()} ${(profile?.last_name || '').trim()}`.trim();
    if (full) return full;
    return (profile?.full_name || '').trim() || 'Aluno';
  }, [profile?.first_name, profile?.last_name, profile?.full_name]);

  const whatsappMessage = useMemo(() => {
    if (!order) return '';
    const quantity = order.custom_quantity ?? order.credits_amount;
    return `Olá professor, preciso de ajuda para finalizar o pedido ${order.id} (${quantity} créditos). Nome: ${studentName}.`;
  }, [order, studentName]);

  const whatsappUrl = useMemo(() => {
    const configured = sanitizePhone(import.meta.env.VITE_PROFESSOR_WHATSAPP || '');
    if (!configured) return null;
    return `https://wa.me/${configured}?text=${encodeURIComponent(whatsappMessage)}`;
  }, [whatsappMessage]);

  const handleOpenWhatsApp = () => {
    if (!whatsappUrl) {
      toast.error('Canal de atendimento indisponível no momento.');
      return;
    }
    window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
  };

  const handleCopyMessage = async () => {
    try {
      await navigator.clipboard.writeText(whatsappMessage);
      toast.success('Mensagem copiada.');
    } catch {
      toast.error('Não foi possível copiar a mensagem.');
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center p-8">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (isError || !order || order.plan_type !== 'custom') {
    return (
      <div className="space-y-4 p-4">
        <div className="rounded-xl border border-border bg-card p-4">
          <h1 className="font-display text-lg uppercase tracking-wider">Plano personalizado</h1>
          <p className="mt-2 text-sm text-muted-foreground">Pedido não encontrado para este fluxo.</p>
          <Button className="mt-4" onClick={() => navigate('/plans')}>
            Voltar para planos
          </Button>
        </div>
      </div>
    );
  }

  const quantity = order.custom_quantity ?? order.credits_amount;

  return (
    <div className="space-y-4 p-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="font-display text-lg uppercase tracking-wider">Suporte para plano personalizado</h1>
          <Badge variant={getStatusVariant(order.status)}>{getPlanOrderStatusLabel(order.status)}</Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          O fluxo principal de pagamento é no Stripe Checkout. Use esta tela apenas se você precisar de atendimento manual.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="font-display text-sm uppercase tracking-wider">Resumo da solicitação</h2>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:text-sm">
          <div className="rounded-md border border-border/70 bg-background/60 p-2">
            <p className="text-muted-foreground">Plano</p>
            <p className="font-medium text-foreground">{order.plan_name}</p>
          </div>
          <div className="rounded-md border border-border/70 bg-background/60 p-2">
            <p className="text-muted-foreground">Tipo de aula</p>
            <p className="font-medium text-foreground">{getClassTypeLabel(order.class_type)}</p>
          </div>
          <div className="rounded-md border border-border/70 bg-background/60 p-2">
            <p className="text-muted-foreground">Quantidade</p>
            <p className="font-medium text-foreground">{quantity} créditos</p>
          </div>
          <div className="rounded-md border border-border/70 bg-background/60 p-2">
            <p className="text-muted-foreground">Validade prevista</p>
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
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
        <div className="flex items-center gap-2">
          <PhoneCall className="h-4 w-4 text-primary" />
          <h2 className="font-display text-sm uppercase tracking-wider">Precisa de ajuda?</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Em caso de dúvida no checkout, fale com o professor. O pedido segue rastreado no painel administrativo.
        </p>
        <div className="rounded-lg border border-primary/30 bg-background/80 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Mensagem sugerida</p>
          <p className="mt-1 text-sm text-foreground">{whatsappMessage}</p>
        </div>
        <Button onClick={handleCopyMessage} variant="outline" className="w-full">
          Copiar mensagem
        </Button>
        <Button onClick={handleOpenWhatsApp} className="w-full font-display uppercase tracking-wider">
          <MessageCircle className="mr-2 h-4 w-4" />
          Falar no WhatsApp
        </Button>
        <Button onClick={() => navigate(`/plans/checkout/${order.id}`)} variant="secondary" className="w-full">
          Voltar ao checkout Stripe
        </Button>
      </div>
    </div>
  );
};

export default PlanCustomContactPage;
