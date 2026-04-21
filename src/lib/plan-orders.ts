export type PlanOrderType = 'fixed' | 'custom';

export type PlanOrderClassType = 'individual' | 'double';

export type PlanOrderPaymentMethod = 'pix' | 'credit_link' | 'manual_contact' | 'stripe_checkout' | null;

export type PlanOrderStatus =
  | 'pending_payment'
  | 'awaiting_approval'
  | 'approved'
  | 'cancelled'
  | 'awaiting_contact';

export const ORDER_FINALIZATION_WINDOW_MINUTES = 30;

export type PlanOrder = {
  id: string;
  user_id: string;
  plan_id: string | null;
  plan_name: string;
  plan_type: PlanOrderType;
  class_type: PlanOrderClassType;
  credits_amount: number;
  validity_days: number;
  price_amount_cents: number;
  payment_method: PlanOrderPaymentMethod;
  status: PlanOrderStatus;
  pix_code: string | null;
  pix_qr_image_url: string | null;
  credit_payment_url: string | null;
  custom_quantity: number | null;
  admin_notes: string | null;
  payment_confirmed_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  payment_provider?: 'legacy_nupay' | 'stripe' | null;
  stripe_checkout_session_id?: string | null;
  stripe_payment_intent_id?: string | null;
  stripe_customer_id?: string | null;
  stripe_checkout_url?: string | null;
  stripe_payment_status?:
    | 'unpaid'
    | 'paid'
    | 'payment_failed'
    | 'expired'
    | 'refunded'
    | 'partially_refunded'
    | 'pending_review'
    | null;
  currency?: string | null;
  amount_subtotal_cents?: number | null;
  amount_total_cents?: number | null;
  paid_at?: string | null;
  payment_method_type?: string | null;
  last_payment_error?: string | null;
  refunded_at?: string | null;
  refund_status?: 'none' | 'partial' | 'full' | null;
  stripe_latest_event_id?: string | null;
  payment_updated_at?: string | null;
  created_at: string;
  updated_at: string;
};

export const formatCurrencyBRL = (valueInCents: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(valueInCents / 100);

export const formatDateTimeBR = (isoDate: string) =>
  new Date(isoDate).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });

export const getPlanOrderStatusLabel = (status: PlanOrderStatus) => {
  switch (status) {
    case 'pending_payment':
      return 'Aguardando pagamento';
    case 'awaiting_approval':
      return 'Aguardando aprovação';
    case 'approved':
      return 'Aprovado';
    case 'cancelled':
      return 'Cancelado';
    case 'awaiting_contact':
      return 'Aguardando contato';
    default:
      return status;
  }
};

export const getPaymentMethodLabel = (method: PlanOrderPaymentMethod) => {
  switch (method) {
    case 'pix':
      return 'PIX';
    case 'credit_link':
      return 'NuPay (Nubank)';
    case 'manual_contact':
      return 'Contato manual';
    case 'stripe_checkout':
      return 'Stripe Checkout';
    default:
      return 'Não informado';
  }
};

export const getClassTypeLabel = (classType: PlanOrderClassType) =>
  classType === 'double' ? 'Dupla' : 'Individual';

export const isOrderFinalizableStatus = (status: PlanOrderStatus) =>
  status === 'pending_payment';

export const getOrderFinalizationDeadlineMs = (createdAt: string) => {
  const createdMs = new Date(createdAt).getTime();
  if (!Number.isFinite(createdMs)) return null;
  return createdMs + ORDER_FINALIZATION_WINDOW_MINUTES * 60 * 1000;
};

export const getOrderRemainingMs = (order: Pick<PlanOrder, 'created_at' | 'status'>, nowMs = Date.now()) => {
  if (!isOrderFinalizableStatus(order.status)) return null;
  const deadlineMs = getOrderFinalizationDeadlineMs(order.created_at);
  if (!deadlineMs) return null;
  return Math.max(deadlineMs - nowMs, 0);
};

export const formatCountdown = (remainingMs: number) => {
  const totalSeconds = Math.max(Math.floor(remainingMs / 1000), 0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};
