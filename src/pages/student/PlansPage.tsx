import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import PlanCarousel from '@/components/plans/PlanCarousel';
import AnimatedSavingsCounter from '@/components/plans/AnimatedSavingsCounter';
import { fetchStudentCreditSummary, type StudentCreditSummary } from '@/lib/student-credits';
import type { PlanOrder, PlanOrderStatus } from '@/lib/plan-orders';
import { toast } from 'sonner';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Dumbbell,
  Minus,
  Plus,
  RefreshCcw,
  Target,
  TrendingUp,
  XCircle,
} from 'lucide-react';

type LessonPlanRow = Database['public']['Tables']['lesson_plans']['Row'];

type ClassType = 'individual' | 'double';
type PlanType = 'fixed' | 'custom';
type PlanBadgeVariant = 'default' | 'secondary' | 'outline';

type FixedPlan = {
  id: string;
  classType: ClassType;
  name: string;
  description: string;
  credits: number;
  totalPriceCents: number;
  validityDays: number;
  badge?: string;
  badgeVariant?: PlanBadgeVariant;
  highlight?: boolean;
  reinforcement?: string;
  note?: string;
  displayUnitPriceCents?: number;
};

type PurchasePlanData = {
  planType: PlanType;
  classType: ClassType;
  credits: number;
  unitPrice: number;
  totalPrice: number;
  validityDays: number;
  planName: string;
  unitPriceCents: number;
  totalPriceCents: number;
};

type SelectedPlanData = {
  id: string;
  plan_id: string | null;
  class_type: string;
  credits: number;
  price_cents: number;
  selected_at: string;
  lesson_plans: { name: string; description: string | null } | null;
};

type RuleItem = {
  icon: LucideIcon;
  title: string;
  description: string;
};

const openOrderStatuses: PlanOrderStatus[] = ['pending_payment', 'awaiting_contact', 'awaiting_approval'];

const MAX_CUSTOM_CREDITS = 30;

const normalizePlanClassType = (rawValue: unknown): ClassType => {
  if (rawValue === 'double') return 'double';
  return 'individual';
};

const ruleItems: RuleItem[] = [
  {
    icon: CheckCircle2,
    title: '1 crédito = 1 aula',
    description: 'Cada crédito corresponde a uma aula particular.',
  },
  {
    icon: Clock3,
    title: 'Validade avulsa',
    description: 'Aula avulsa (1 crédito) tem validade de 15 dias.',
  },
  {
    icon: CalendarClock,
    title: 'Validade dos pacotes',
    description: 'Compras de 2 a 9 créditos valem 30 dias; com 10+ créditos, validade de 45 dias.',
  },
  {
    icon: RefreshCcw,
    title: 'Remarcação',
    description: 'Permitido remarcar a aula com até 24h de antecedência.',
  },
  {
    icon: XCircle,
    title: 'Cancelamento fora do prazo',
    description: 'Cancelamentos fora do prazo consomem o crédito.',
  },
  {
    icon: Dumbbell,
    title: 'Duração da aula',
    description: 'Duração média das aulas: 50 minutos.',
  },
  {
    icon: CheckCircle2,
    title: 'Confirmação manual',
    description: 'Seus créditos são liberados somente após validação do pagamento pelo professor.',
  },
];

const formatCurrencyBRL = (cents: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);

const formatDateBR = (date: Date) =>
  new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);

const clampCredits = (value: number) => {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_CUSTOM_CREDITS, Math.max(1, Math.trunc(value)));
};

const getValidityDays = (credits: number) => {
  if (credits === 1) return 15;
  if (credits >= 10) return 45;
  return 30;
};

const getFixedUnitPriceCents = (plan: FixedPlan) =>
  plan.displayUnitPriceCents ?? plan.totalPriceCents / plan.credits;

const getCustomIndividualUnitPrice = (credits: number) => {
  if (credits <= 1) return 10000;
  if (credits <= 3) return 9700;
  if (credits <= 7) return 9500;
  if (credits <= 11) return 9000;
  return 100000 / 12;
};

const getCustomDoubleUnitPrice = (credits: number) => {
  if (credits <= 1) return 15000;
  if (credits <= 3) return 14550;
  if (credits <= 7) return 14250;
  if (credits <= 11) return 13500;
  return 12500;
};

const getCustomUnitPrice = (classType: ClassType, credits: number) =>
  classType === 'individual' ? getCustomIndividualUnitPrice(credits) : getCustomDoubleUnitPrice(credits);

const getClassTypeLabel = (classType: ClassType) => (classType === 'individual' ? 'Individual' : 'Dupla');
const formatCountLabel = (count: number, singular: string, plural: string) =>
  `${count} ${count === 1 ? singular : plural}`;

const calculateSavings = ({
  baseUnitPriceCents,
  currentUnitPriceCents,
  quantity,
}: {
  baseUnitPriceCents: number;
  currentUnitPriceCents: number;
  quantity: number;
}) => {
  const perClassSavingsCents = Math.max(baseUnitPriceCents - currentUnitPriceCents, 0);
  const totalSavingsCents = Math.max(perClassSavingsCents * quantity, 0);
  return { perClassSavingsCents, totalSavingsCents };
};

const toPurchaseData = (
  planType: PlanType,
  classType: ClassType,
  credits: number,
  unitPriceCents: number,
  totalPriceCents: number,
  planName: string,
): PurchasePlanData => ({
  planType,
  classType,
  credits,
  unitPrice: Number((unitPriceCents / 100).toFixed(2)),
  totalPrice: Number((totalPriceCents / 100).toFixed(2)),
  validityDays: getValidityDays(credits),
  planName,
  unitPriceCents,
  totalPriceCents,
});

const PlansPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedClassType, setSelectedClassType] = useState<ClassType | null>(null);
  const [customCredits, setCustomCredits] = useState(1);
  const [lastPurchase, setLastPurchase] = useState<PurchasePlanData | null>(null);
  const [highlightedPlanId, setHighlightedPlanId] = useState<string | null>(null);
  const [focusPlanId, setFocusPlanId] = useState<string | null>(null);
  const [focusPlanSignal, setFocusPlanSignal] = useState(0);
  const fixedPlansSectionRef = useRef<HTMLDivElement | null>(null);

  const { data: dbPlans = [], isLoading } = useQuery({
    queryKey: ['student-lesson-plans'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lesson_plans')
        .select('*')
        .eq('is_active', true)
        .order('class_type', { ascending: true })
        .order('sort_order', { ascending: true })
        .order('credits', { ascending: true });
      if (error) throw error;
      return data as LessonPlanRow[];
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel('student-lesson-plans-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lesson_plans' },
        () => {
          queryClient.invalidateQueries({ queryKey: ['student-lesson-plans'] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const { data: selectedPlan } = useQuery({
    queryKey: ['selected-plan', user?.id],
    queryFn: async () => {
      if (!user) return null;

      const { data, error } = await supabase
        .from('student_plan_selections')
        .select('id, plan_id, class_type, credits, price_cents, selected_at, lesson_plans(name, description)')
        .eq('student_id', user.id)
        .eq('status', 'active')
        .order('selected_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data as SelectedPlanData | null;
    },
    enabled: !!user,
  });

  const { data: creditSummary } = useQuery<StudentCreditSummary>({
    queryKey: ['credit-summary', user?.id],
    queryFn: async () => {
      if (!user) {
        return {
          totalCredits: 0,
          usedCredits: 0,
          remainingCredits: 0,
          nextExpirationAt: null,
        };
      }
      return fetchStudentCreditSummary(user.id);
    },
    enabled: !!user,
  });

  const { data: openOrders = [] } = useQuery<PlanOrder[]>({
    queryKey: ['student-open-plan-orders', user?.id],
    queryFn: async () => {
      if (!user) return [];

      const { data, error } = await supabase
        .from('plan_orders')
        .select('*')
        .eq('user_id', user.id)
        .in('status', openOrderStatuses)
        .order('created_at', { ascending: false })
        .limit(5);

      if (error) throw error;
      return (data ?? []) as PlanOrder[];
    },
    enabled: !!user,
  });

  const createFixedOrderMutation = useMutation({
    mutationFn: async (planId: string) => {
      const { data, error } = await supabase.rpc('create_fixed_plan_order', {
        p_plan_id: planId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (orderId) => {
      toast.success('Pedido criado. Escolha a forma de pagamento.');
      queryClient.invalidateQueries({ queryKey: ['plan-orders'] });
      queryClient.invalidateQueries({ queryKey: ['student-open-plan-orders'] });
      navigate(`/plans/checkout/${orderId}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const createCustomOrderMutation = useMutation({
    mutationFn: async ({ classType, quantity }: { classType: ClassType; quantity: number }) => {
      const { data, error } = await supabase.rpc('create_custom_plan_order', {
        p_class_type: classType,
        p_custom_quantity: quantity,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (orderId) => {
      toast.success('Solicitacao personalizada criada.');
      queryClient.invalidateQueries({ queryKey: ['plan-orders'] });
      queryClient.invalidateQueries({ queryKey: ['student-open-plan-orders'] });
      navigate(`/plans/custom/${orderId}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const fixedPlansByClassType = useMemo<Record<ClassType, FixedPlan[]>>(() => {
    const grouped: Record<ClassType, LessonPlanRow[]> = {
      individual: [],
      double: [],
    };

    dbPlans.forEach((plan) => {
      grouped[normalizePlanClassType(plan.class_type)].push(plan);
    });

    const mapPlans = (classType: ClassType) => {
      const sorted = [...grouped[classType]].sort(
        (a, b) => a.sort_order - b.sort_order || a.credits - b.credits || a.price_cents - b.price_cents,
      );
      if (!sorted.length) return [];

      const now = Date.now();
      const newBadgeWindowMs = 30 * 24 * 60 * 60 * 1000;
      const minCredits = Math.min(...sorted.map((plan) => plan.credits));
      const unitPrices = sorted.map((plan) => Math.round(plan.price_cents / Math.max(plan.credits, 1)));
      const bestUnitPrice = Math.min(...unitPrices);

      return sorted.map((plan) => {
        const unitPriceCents = Math.round(plan.price_cents / Math.max(plan.credits, 1));
        const isEntry = plan.credits === minCredits;
        const isBestValue = sorted.length > 1 && unitPriceCents === bestUnitPrice && !isEntry;
        const createdAt = new Date(plan.created_at).getTime();
        const isNew = Number.isFinite(createdAt) && now - createdAt <= newBadgeWindowMs;

        return {
          id: plan.id,
          classType,
          name: plan.name,
          description: plan.description || 'Plano configurado pelo professor.',
          credits: plan.credits,
          totalPriceCents: plan.price_cents,
          validityDays: getValidityDays(plan.credits),
          badge: isNew ? 'Novo' : isEntry ? 'Entrada' : isBestValue ? 'Melhor valor' : undefined,
          badgeVariant: isNew ? 'default' : isEntry ? 'outline' : isBestValue ? 'default' : undefined,
          highlight: isNew || isBestValue,
          note: classType === 'double' ? 'Valor total para 2 alunos.' : undefined,
          displayUnitPriceCents: unitPriceCents,
        } as FixedPlan;
      });
    };

    return {
      individual: mapPlans('individual'),
      double: mapPlans('double'),
    };
  }, [dbPlans]);

  const customPreview = useMemo(() => {
    if (!selectedClassType) return null;

    const normalizedCredits = clampCredits(customCredits);
    const unitPriceCents = getCustomUnitPrice(selectedClassType, normalizedCredits);
    const totalPriceCents = Math.round(unitPriceCents * normalizedCredits);
    const planName =
      selectedClassType === 'individual'
        ? `Plano personalizado individual - ${formatCountLabel(normalizedCredits, 'crédito', 'créditos')}`
        : `Plano personalizado dupla - ${formatCountLabel(normalizedCredits, 'crédito', 'créditos')}`;

    return toPurchaseData(
      'custom',
      selectedClassType,
      normalizedCredits,
      unitPriceCents,
      totalPriceCents,
      planName,
    );
  }, [customCredits, selectedClassType]);

  const equivalentCustomFixedPlan = useMemo(() => {
    if (!customPreview || !selectedClassType) return null;
    const plans = fixedPlansByClassType[selectedClassType];

    return (
      plans.find(
        (plan) =>
          plan.credits === customPreview.credits && Math.abs(plan.totalPriceCents - customPreview.totalPriceCents) <= 1,
      ) || null
    );
  }, [customPreview, fixedPlansByClassType, selectedClassType]);

  const comparisonRows = useMemo(() => {
    if (!selectedClassType) return [];
    const fixedPlans = fixedPlansByClassType[selectedClassType];
    if (!fixedPlans.length) return [];

    const baseUnitPriceCents = getFixedUnitPriceCents(fixedPlans[0]);
    const rows = fixedPlans.map((plan) => {
      const unitPriceCents = getFixedUnitPriceCents(plan);
      const savings = calculateSavings({
        baseUnitPriceCents,
        currentUnitPriceCents: unitPriceCents,
        quantity: plan.credits,
      });
      return {
        plan,
        unitPriceCents,
        ...savings,
      };
    });
    const maxTotalSavings = Math.max(...rows.map((row) => row.totalSavingsCents), 1);

    return rows.map((row) => ({
      ...row,
      savingsBarPercent:
        row.totalSavingsCents > 0 ? Math.max(12, Math.round((row.totalSavingsCents / maxTotalSavings) * 100)) : 0,
    }));
  }, [fixedPlansByClassType, selectedClassType]);

  const highlightedPurchase = lastPurchase || customPreview;
  const selectedFixedPlans = useMemo(
    () => (selectedClassType ? fixedPlansByClassType[selectedClassType] : []),
    [fixedPlansByClassType, selectedClassType],
  );
  const baseFixedUnitPriceCents = selectedFixedPlans.length > 0 ? getFixedUnitPriceCents(selectedFixedPlans[0]) : 0;
  const primaryPlanIndex = selectedFixedPlans.findIndex((plan) => !!plan.highlight || plan.badge === 'Melhor valor');
  const focusedPlanIndex = focusPlanId
    ? selectedFixedPlans.findIndex((plan) => plan.id === focusPlanId)
    : -1;
  const latestOpenOrder = openOrders[0] ?? null;

  const handleFixedPlanPurchase = (planData: PurchasePlanData, planId: string) => {
    setLastPurchase(planData);
    createFixedOrderMutation.mutate(planId);
  };

  const handleCustomPlanPurchase = (planData: PurchasePlanData) => {
    setLastPurchase(planData);
    createCustomOrderMutation.mutate({
      classType: planData.classType,
      quantity: planData.credits,
    });
  };

  const totalCredits = creditSummary?.totalCredits ?? 0;
  const usedCredits = creditSummary?.usedCredits ?? 0;
  const remaining = creditSummary?.remainingCredits ?? 0;
  const creditExpiryInfo = useMemo(() => {
    if ((creditSummary?.remainingCredits ?? 0) <= 0) return null;
    const nextExpiration = creditSummary?.nextExpirationAt;
    if (!nextExpiration) return null;

    const expiresAt = new Date(nextExpiration);
    if (!Number.isFinite(expiresAt.getTime())) return null;

    const diffMs = expiresAt.getTime() - Date.now();
    const daysRemaining = Math.max(0, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));

    return {
      daysRemaining,
      expiresAtLabel: formatDateBR(expiresAt),
    };
  }, [creditSummary?.nextExpirationAt, creditSummary?.remainingCredits]);

  const scrollToEquivalentPlan = (planToFocus: FixedPlan) => {
    if (!selectedClassType) return;
    fixedPlansSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setHighlightedPlanId(planToFocus.id);
    setFocusPlanId(planToFocus.id);
    setFocusPlanSignal((prev) => prev + 1);
  };

  const handleClassTypeSelection = (classType: ClassType) => {
    setSelectedClassType(classType);
    setHighlightedPlanId(null);
    setFocusPlanId(null);
  };

  return (
    <div className="space-y-4 p-4">
      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-display text-xl uppercase tracking-wider">Planos e créditos</h1>
            <p className="pt-2 text-sm text-muted-foreground">Escolha o plano ideal para sua rotina e treine com constância.</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">
            Créditos utilizados: {usedCredits}/{totalCredits}
          </Badge>
          <Badge variant={remaining > 0 ? 'default' : 'outline'}>Restantes: {remaining}</Badge>
          {selectedPlan?.lesson_plans?.name && (
            <Badge variant="outline">Plano atual: {selectedPlan.lesson_plans.name}</Badge>
          )}
        </div>

        {latestOpenOrder && (
          <div className="rounded-lg border border-primary/30 bg-primary/10 p-3">
            <p className="text-sm font-medium text-foreground">Voce tem um pedido em andamento.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Se fechar a aba, retome depois na pagina de pedidos em andamento.
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                onClick={() =>
                  navigate(
                    latestOpenOrder.plan_type === 'fixed'
                      ? `/plans/checkout/${latestOpenOrder.id}`
                      : `/plans/custom/${latestOpenOrder.id}`,
                  )
                }
              >
                Continuar ultimo pedido
              </Button>
              <Button variant="ghost" onClick={() => navigate('/plans/orders')}>
                Ver pedidos em andamento
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex items-start gap-2">
          <Target className="mt-0.5 h-4 w-4 text-primary" />
          <div className="space-y-1">
            <h2 className="font-display text-base uppercase tracking-wider">Regras e funcionamento</h2>
            <p className="text-sm text-muted-foreground">
              Compre seus créditos e agende direto pela plataforma, com praticidade para manter a frequência.
            </p>
          </div>
        </div>
        {creditExpiryInfo && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
            <p className="text-sm font-medium text-foreground">
              Seus créditos atuais expiram em {formatCountLabel(creditExpiryInfo.daysRemaining, 'dia', 'dias')} (
              {creditExpiryInfo.expiresAtLabel}).
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Créditos acumulam no seu saldo, e a validade é renovada pela maior data entre o saldo atual e a nova compra.
            </p>
          </div>
        )}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {ruleItems.map((rule) => (
            <div key={rule.title} className="rounded-lg border border-border/70 bg-background/50 p-3">
              <div className="flex items-start gap-2">
                <rule.icon className="mt-0.5 h-4 w-4 text-primary" />
                <div>
                  <p className="text-sm font-medium text-foreground">{rule.title}</p>
                  <p className="text-xs text-muted-foreground">{rule.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="space-y-1">
          <h2 className="font-display text-base uppercase tracking-wider">Escolha o tipo de aula</h2>
          <p className="text-sm text-muted-foreground">
            Treine no seu ritmo, com planos pensados para dar consistência ao seu treino.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={selectedClassType === 'individual' ? 'default' : 'outline'}
            onClick={() => handleClassTypeSelection('individual')}
            className="font-display uppercase tracking-wider"
          >
            Individual
          </Button>
          <Button
            type="button"
            variant={selectedClassType === 'double' ? 'default' : 'outline'}
            onClick={() => handleClassTypeSelection('double')}
            className="font-display uppercase tracking-wider"
          >
            Dupla
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : !selectedClassType ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Selecione o tipo de aula acima para visualizar os planos, comparar economia e montar seu plano personalizado.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div ref={fixedPlansSectionRef} className="space-y-3">
            <div className="space-y-1">
              <h2 className="font-display text-base uppercase tracking-wider">
                {selectedClassType === 'individual' ? 'Planos fixos individuais' : 'Planos fixos em dupla'}
              </h2>
              <p className="text-sm text-muted-foreground">Quanto maior o pacote, melhor o valor por crédito.</p>
            </div>

            {selectedFixedPlans.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-background/40 p-4 text-sm text-muted-foreground">
                Nenhum plano ativo para {selectedClassType === 'individual' ? 'aulas individuais' : 'aulas em dupla'}.
              </div>
            ) : (
              <PlanCarousel
                plans={selectedFixedPlans}
                getPlanKey={(plan) => plan.id}
                primaryPlanIndex={primaryPlanIndex >= 0 ? primaryPlanIndex : undefined}
                focusPlanIndex={focusedPlanIndex >= 0 ? focusedPlanIndex : undefined}
                focusPlanSignal={focusPlanSignal}
                focusPauseMs={3200}
                renderPlanCard={(plan, _index, slideState) => {
                  const unitPriceCents = getFixedUnitPriceCents(plan);
                  const perStudentCents = unitPriceCents / 2;
                  const isSelected = selectedPlan?.plan_id === plan.id;
                  const isApplying = createFixedOrderMutation.isPending && createFixedOrderMutation.variables === plan.id;
                  const isDouble = selectedClassType === 'double';
                  const isEquivalentHighlighted = highlightedPlanId === plan.id;
                  const isHighlighted = !!plan.highlight || isEquivalentHighlighted;
                  const isMainChosen = plan.badge === 'Melhor valor';
                  const { totalSavingsCents } = calculateSavings({
                    baseUnitPriceCents: baseFixedUnitPriceCents,
                    currentUnitPriceCents: unitPriceCents,
                    quantity: plan.credits,
                  });

                  const purchaseData = toPurchaseData(
                    'fixed',
                    selectedClassType,
                    plan.credits,
                    unitPriceCents,
                    plan.totalPriceCents,
                    plan.name,
                  );

                  return (
                    <div
                      className={`rounded-xl border bg-card p-4 transition-all animate-fade-in ${
                        isHighlighted ? 'border-primary/60 shadow-md shadow-primary/15' : 'border-border'
                      } ${
                        slideState.isActive ? 'shadow-lg shadow-primary/20' : 'shadow-sm shadow-black/5'
                      } ${
                        isHighlighted ? 'bg-gradient-to-b from-primary/10 via-card to-card' : 'bg-gradient-to-b from-background/60 to-card'
                      } ${isMainChosen && slideState.isActive ? 'lg:scale-[1.02]' : ''} ${
                        isEquivalentHighlighted ? 'plan-equivalent-pulse' : ''
                      }`}
                    >
                      <div className="flex h-full flex-col gap-3">
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-base font-medium text-foreground">{plan.name}</p>
                            {plan.badge && (
                              <Badge
                                variant={plan.badgeVariant ?? 'secondary'}
                                className="px-2 py-0 text-[10px] uppercase leading-4 tracking-wide sm:text-xs"
                              >
                                {plan.badge}
                              </Badge>
                            )}
                            {isSelected && <Badge variant="outline">Plano atual</Badge>}
                          </div>

                          <div>
                            <p className="text-2xl font-semibold leading-none text-foreground">
                              {formatCurrencyBRL(plan.totalPriceCents)}
                            </p>
                            <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">valor total</p>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="rounded-md border border-border/70 bg-background/60 p-2">
                              <p className="text-[11px] text-muted-foreground">{isDouble ? 'Valor por aluno' : 'Valor por aula'}</p>
                              <p className="font-medium text-foreground">
                                {formatCurrencyBRL(isDouble ? perStudentCents : unitPriceCents)}
                              </p>
                            </div>
                            <div className="rounded-md border border-border/70 bg-background/60 p-2">
                              <p className="text-[11px] text-muted-foreground">Créditos</p>
                              <p className="font-medium text-foreground">{plan.credits}</p>
                            </div>
                            <div className="rounded-md border border-border/70 bg-background/60 p-2">
                              <p className="text-[11px] text-muted-foreground">Validade</p>
                              <p className="font-medium text-foreground">
                                {formatCountLabel(plan.validityDays, 'dia', 'dias')}
                              </p>
                            </div>
                            <div className="rounded-md border border-border/70 bg-background/60 p-2">
                              <p className="text-[11px] text-muted-foreground">Tipo</p>
                              <p className="font-medium text-foreground">{getClassTypeLabel(selectedClassType)}</p>
                            </div>
                          </div>

                          {totalSavingsCents > 0 && (
                            <div className="rounded-md border border-primary/30 bg-primary/10 p-2">
                              <p className="text-[11px] text-primary">Mais aulas, menor valor por aula.</p>
                              <p className="text-sm font-semibold text-primary">
                                Economize{' '}
                                <AnimatedSavingsCounter valueCents={totalSavingsCents} isActive={slideState.isActive} />
                              </p>
                              <p className="text-[11px] text-muted-foreground">em relação as aulas avulsas.</p>
                            </div>
                          )}

                          <p className="text-sm text-muted-foreground">{plan.description}</p>

                          {plan.note && <p className="text-xs text-muted-foreground">{plan.note}</p>}
                          {plan.reinforcement && <p className="text-xs font-medium text-primary">{plan.reinforcement}</p>}
                        </div>

                        <Button
                          onClick={() => handleFixedPlanPurchase(purchaseData, plan.id)}
                          disabled={isApplying || isSelected}
                          className="mt-auto w-full font-display uppercase tracking-wider"
                        >
                          {isSelected ? 'Plano atual' : isApplying ? 'Aplicando...' : 'Comprar créditos'}
                        </Button>
                      </div>
                    </div>
                  );
                }}
              />
            )}
          </div>

          <div className="space-y-3 rounded-xl border border-border bg-card p-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                <h3 className="font-display text-sm uppercase tracking-wider">Compare a economia dos planos</h3>
              </div>
              <p className="text-sm text-muted-foreground">Quanto mais aulas, melhor o valor por crédito.</p>
            </div>

            <div className="space-y-2">
              {comparisonRows.map((row) => {
                const isDouble = selectedClassType === 'double';
                const displayUnit = isDouble ? row.unitPriceCents / 2 : row.unitPriceCents;
                const displayUnitLabel = isDouble ? 'Valor por aluno' : 'Valor por aula';
                const savingsPerCreditText = isDouble
                  ? `Economia da dupla por crédito: ${formatCurrencyBRL(row.perClassSavingsCents)}`
                  : `Economiza ${formatCurrencyBRL(row.perClassSavingsCents)} por aula`;

                return (
                  <div key={`comparison-${row.plan.name}`} className="rounded-lg border border-border/70 bg-background/60 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">{row.plan.name}</p>
                      <p className="text-sm font-semibold text-foreground">
                        {displayUnitLabel}: {formatCurrencyBRL(displayUnit)}
                      </p>
                    </div>
                    {row.totalSavingsCents > 0 ? (
                      <div className="mt-2 space-y-1">
                        <p className="text-xs text-primary">{savingsPerCreditText}</p>
                        <p className="text-xs text-muted-foreground">
                          Economia total aproximada: {formatCurrencyBRL(row.totalSavingsCents)}
                        </p>
                        <div className="h-2 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary/80" style={{ width: `${row.savingsBarPercent}%` }} />
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-muted-foreground">Referência de comparação (sem economia acumulada).</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-border bg-card p-4">
            <div className="space-y-1">
              <h2 className="font-display text-base uppercase tracking-wider">Monte seu plano</h2>
              <p className="text-sm text-muted-foreground">
                Escolha a quantidade de aulas ideal para sua rotina. Quanto mais créditos, melhor o valor por aula.
              </p>
              <p className="text-xs text-muted-foreground">
                Os pacotes prontos oferecem a melhor visualização de custo-benefício, mas você também pode personalizar sua compra.
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="custom-credits">Quantidade de aulas / créditos</Label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setCustomCredits((prev) => clampCredits(prev - 1))}
                  disabled={!customPreview || customPreview.credits <= 1}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <Input
                  id="custom-credits"
                  type="number"
                  min={1}
                  max={MAX_CUSTOM_CREDITS}
                  value={customPreview?.credits ?? 1}
                  onChange={(e) => setCustomCredits(clampCredits(Number(e.target.value)))}
                  className="bg-background text-center"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setCustomCredits((prev) => clampCredits(prev + 1))}
                  disabled={!customPreview || customPreview.credits >= MAX_CUSTOM_CREDITS}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Mínimo 1 crédito e máximo {formatCountLabel(MAX_CUSTOM_CREDITS, 'crédito', 'créditos')}.
              </p>
            </div>

            <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
              <p className="text-sm font-medium text-foreground">Resumo da compra personalizada</p>
              {customPreview && (
                <>
                  <div className="grid grid-cols-2 gap-2 text-xs sm:text-sm">
                    <div className="rounded-md border border-primary/20 bg-background/70 p-2">
                      <p className="text-muted-foreground">Tipo de aula</p>
                      <p className="font-medium text-foreground">{getClassTypeLabel(customPreview.classType)}</p>
                    </div>
                    <div className="rounded-md border border-primary/20 bg-background/70 p-2">
                      <p className="text-muted-foreground">Quantidade</p>
                      <p className="font-medium text-foreground">
                        {formatCountLabel(customPreview.credits, 'crédito', 'créditos')}
                      </p>
                    </div>
                    <div className="rounded-md border border-primary/20 bg-background/70 p-2">
                      <p className="text-muted-foreground">
                        {customPreview.classType === 'double' ? 'Valor por aluno' : 'Valor por aula'}
                      </p>
                      <p className="font-medium text-foreground">
                        {formatCurrencyBRL(
                          customPreview.classType === 'double'
                            ? customPreview.unitPriceCents / 2
                            : customPreview.unitPriceCents,
                        )}
                      </p>
                    </div>
                    <div className="rounded-md border border-primary/20 bg-background/70 p-2">
                      <p className="text-muted-foreground">Valor total</p>
                      <p className="font-medium text-foreground">{formatCurrencyBRL(customPreview.totalPriceCents)}</p>
                    </div>
                    <div className="rounded-md border border-primary/20 bg-background/70 p-2">
                      <p className="text-muted-foreground">Validade</p>
                      <p className="font-medium text-foreground">
                        {formatCountLabel(customPreview.validityDays, 'dia', 'dias')}
                      </p>
                    </div>
                  </div>
                  {equivalentCustomFixedPlan && (
                    <div className="rounded-md border border-primary/40 bg-background/80 p-2">
                      <p className="text-xs font-medium text-primary">
                        Você está no mesmo valor do pacote de{' '}
                        {formatCountLabel(equivalentCustomFixedPlan.credits, 'aula', 'aulas')}.
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => scrollToEquivalentPlan(equivalentCustomFixedPlan)}
                        className="mt-2"
                      >
                        Ver plano de {formatCountLabel(equivalentCustomFixedPlan.credits, 'aula', 'aulas')}
                        <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>

            <Button
              onClick={() => customPreview && handleCustomPlanPurchase(customPreview)}
              disabled={!customPreview || createCustomOrderMutation.isPending}
              className="w-full font-display uppercase tracking-wider sm:w-auto"
            >
              {createCustomOrderMutation.isPending ? 'Criando solicitação...' : 'Solicitar plano personalizado'}
            </Button>
          </div>

          {highlightedPurchase && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h2 className="font-display text-sm uppercase tracking-wider">Resumo em destaque</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Planos pensados para dar consistência ao seu treino e facilitar seu agendamento.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:text-sm">
                <div className="rounded-md border border-border/70 bg-background/60 p-2">
                  <p className="text-muted-foreground">Plano</p>
                  <p className="font-medium text-foreground">{highlightedPurchase.planName}</p>
                </div>
                <div className="rounded-md border border-border/70 bg-background/60 p-2">
                  <p className="text-muted-foreground">Modelo</p>
                  <p className="font-medium text-foreground">
                    {highlightedPurchase.planType === 'fixed' ? 'Fixo' : 'Personalizado'}
                  </p>
                </div>
                <div className="rounded-md border border-border/70 bg-background/60 p-2">
                  <p className="text-muted-foreground">Tipo de aula</p>
                  <p className="font-medium text-foreground">{getClassTypeLabel(highlightedPurchase.classType)}</p>
                </div>
                <div className="rounded-md border border-border/70 bg-background/60 p-2">
                  <p className="text-muted-foreground">Créditos</p>
                  <p className="font-medium text-foreground">{highlightedPurchase.credits}</p>
                </div>
                <div className="rounded-md border border-border/70 bg-background/60 p-2">
                  <p className="text-muted-foreground">
                    {highlightedPurchase.classType === 'double' ? 'Valor por aluno' : 'Valor unitário'}
                  </p>
                  <p className="font-medium text-foreground">
                    {formatCurrencyBRL(
                      highlightedPurchase.classType === 'double'
                        ? highlightedPurchase.unitPriceCents / 2
                        : highlightedPurchase.unitPriceCents,
                    )}
                  </p>
                </div>
                <div className="rounded-md border border-border/70 bg-background/60 p-2">
                  <p className="text-muted-foreground">Valor total</p>
                  <p className="font-medium text-foreground">{formatCurrencyBRL(highlightedPurchase.totalPriceCents)}</p>
                </div>
                <div className="rounded-md border border-border/70 bg-background/60 p-2">
                  <p className="text-muted-foreground">Validade</p>
                  <p className="font-medium text-foreground">
                    {formatCountLabel(highlightedPurchase.validityDays, 'dia', 'dias')}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PlansPage;
