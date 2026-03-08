import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import PlanCarousel from '@/components/plans/PlanCarousel';
import AnimatedSavingsCounter from '@/components/plans/AnimatedSavingsCounter';
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
  plan_id: string;
  month_ref: string;
  credits: number;
  price_cents: number;
  lesson_plans: { name: string; description: string | null } | null;
};

type RuleItem = {
  icon: LucideIcon;
  title: string;
  description: string;
};

const MAX_CUSTOM_CREDITS = 30;

const fixedIndividualPlans: FixedPlan[] = [
  {
    name: 'Aula Avulsa',
    description: 'Ideal para experimentar uma aula particular ou treinar pontualmente.',
    credits: 1,
    totalPriceCents: 10000,
    validityDays: 15,
    badge: 'Entrada',
    badgeVariant: 'outline',
  },
  {
    name: 'Pacote 4 Aulas',
    description: 'Ótimo para manter constância e evoluir com treinos semanais.',
    credits: 4,
    totalPriceCents: 38000,
    validityDays: 30,
  },
  {
    name: 'Pacote 8 Aulas',
    description: 'Mais ritmo de treino e melhor custo por aula para acelerar sua evolução.',
    credits: 8,
    totalPriceCents: 72000,
    validityDays: 30,
    badge: 'Mais escolhido',
    badgeVariant: 'default',
    highlight: true,
  },
  {
    name: 'Pacote 12 Aulas',
    description: 'Melhor custo-benefício para quem quer levar o treino a sério.',
    credits: 12,
    totalPriceCents: 100000,
    validityDays: 45,
    badge: 'Melhor custo-benefício',
    badgeVariant: 'secondary',
    reinforcement: 'Plano com maior economia total para manter constância no treino.',
    displayUnitPriceCents: 100000 / 12,
  },
];

const fixedDoublePlans: FixedPlan[] = [
  {
    name: 'Aula Dupla Avulsa',
    description: 'Treine com um parceiro e divida a experiência em uma aula dinâmica.',
    credits: 1,
    totalPriceCents: 16000,
    validityDays: 15,
    note: 'Valor total para 2 alunos.',
    badge: 'Entrada',
    badgeVariant: 'outline',
  },
  {
    name: 'Pacote 4 Aulas em Dupla',
    description: 'Boa opção para manter frequência treinando em dupla.',
    credits: 4,
    totalPriceCents: 60000,
    validityDays: 30,
  },
  {
    name: 'Pacote 8 Aulas em Dupla',
    description: 'Mais consistência no treino com um valor melhor por crédito.',
    credits: 8,
    totalPriceCents: 112000,
    validityDays: 30,
  },
  {
    name: 'Pacote 12 Aulas em Dupla',
    description: 'Plano ideal para dupla que quer constância e melhor aproveitamento.',
    credits: 12,
    totalPriceCents: 156000,
    validityDays: 45,
    badge: 'Maior economia por aluno',
    badgeVariant: 'default',
    highlight: true,
    reinforcement: 'Maior redução por aluno para dupla com foco em evolução contínua.',
  },
];

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
    description: 'Compras com 2 a 10 créditos valem 30 dias; acima de 10 créditos, 45 dias.',
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
];

const formatCurrencyBRL = (cents: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);

const getMonthBounds = (monthRef: string) => {
  const [year, month] = monthRef.split('-').map(Number);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;

  return {
    start: `${year}-${String(month).padStart(2, '0')}-01T00:00:00-03:00`,
    end: `${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00-03:00`,
  };
};

const clampCredits = (value: number) => {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_CUSTOM_CREDITS, Math.max(1, Math.trunc(value)));
};

const getValidityDays = (credits: number) => {
  if (credits === 1) return 15;
  if (credits > 10) return 45;
  return 30;
};

const getFixedPlansByClassType = (classType: ClassType) =>
  classType === 'individual' ? fixedIndividualPlans : fixedDoublePlans;

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
  if (credits <= 1) return 16000;
  if (credits <= 3) return 15500;
  if (credits <= 7) return 15000;
  if (credits <= 11) return 14000;
  return 13000;
};

const getCustomUnitPrice = (classType: ClassType, credits: number) =>
  classType === 'individual' ? getCustomIndividualUnitPrice(credits) : getCustomDoubleUnitPrice(credits);

const getClassTypeLabel = (classType: ClassType) => (classType === 'individual' ? 'Individual' : 'Dupla');

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

const getEquivalentPlan = (quantity: number, classType: ClassType) => {
  const fixedPlans = getFixedPlansByClassType(classType);
  return (
    fixedPlans.find(
      (plan) => plan.credits === quantity && (plan.credits === 4 || plan.credits === 8 || plan.credits === 12),
    ) || null
  );
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
  const queryClient = useQueryClient();
  const [selectedClassType, setSelectedClassType] = useState<ClassType | null>(null);
  const [customCredits, setCustomCredits] = useState(1);
  const [lastPurchase, setLastPurchase] = useState<PurchasePlanData | null>(null);
  const [highlightedPlanCredits, setHighlightedPlanCredits] = useState<number | null>(null);
  const [monthInput, setMonthInput] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const monthRef = `${monthInput}-01`;

  const { data: dbPlans = [], isLoading } = useQuery({
    queryKey: ['student-lesson-plans'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lesson_plans')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('credits', { ascending: true });
      if (error) throw error;
      return data as LessonPlanRow[];
    },
  });

  const { data: selectedPlan } = useQuery({
    queryKey: ['selected-plan', user?.id, monthRef],
    queryFn: async () => {
      if (!user) return null;

      const { data, error } = await supabase
        .from('student_plan_selections')
        .select('id, month_ref, credits, price_cents, plan_id, lesson_plans(name, description)')
        .eq('student_id', user.id)
        .eq('month_ref', monthRef)
        .eq('status', 'active')
        .maybeSingle();

      if (error) throw error;
      return data as SelectedPlanData | null;
    },
    enabled: !!user,
  });

  const { data: credits } = useQuery({
    queryKey: ['my-credits', user?.id, monthRef],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from('student_month_credits')
        .select('*')
        .eq('student_id', user.id)
        .eq('month_ref', monthRef)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: usedCredits = 0 } = useQuery({
    queryKey: ['used-credits', user?.id, monthRef],
    queryFn: async () => {
      if (!user) return 0;
      const { start, end } = getMonthBounds(monthRef);
      const { count, error } = await supabase
        .from('bookings')
        .select('id, availability_slots!inner(start_time)', { count: 'exact', head: true })
        .eq('student_id', user.id)
        .eq('status', 'booked')
        .gte('availability_slots.start_time', start)
        .lt('availability_slots.start_time', end);

      if (error) throw error;
      return count || 0;
    },
    enabled: !!user,
  });

  const choosePlanMutation = useMutation({
    mutationFn: async (planId: string) => {
      const { error } = await supabase.rpc('choose_plan', {
        p_plan_id: planId,
        p_month_ref: monthRef,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Plano aplicado com sucesso.');
      queryClient.invalidateQueries({ queryKey: ['selected-plan'] });
      queryClient.invalidateQueries({ queryKey: ['my-credits'] });
      queryClient.invalidateQueries({ queryKey: ['used-credits'] });
      queryClient.invalidateQueries({ queryKey: ['slots'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const dbIndividualPlansByCredits = useMemo(() => {
    const byCredits = new Map<number, LessonPlanRow>();
    dbPlans.forEach((plan) => {
      if (!byCredits.has(plan.credits)) {
        byCredits.set(plan.credits, plan);
      }
    });
    return byCredits;
  }, [dbPlans]);

  const customPreview = useMemo(() => {
    if (!selectedClassType) return null;

    const normalizedCredits = clampCredits(customCredits);
    const unitPriceCents = getCustomUnitPrice(selectedClassType, normalizedCredits);
    const totalPriceCents = Math.round(unitPriceCents * normalizedCredits);
    const planName =
      selectedClassType === 'individual'
        ? `Plano personalizado individual - ${normalizedCredits} créditos`
        : `Plano personalizado dupla - ${normalizedCredits} créditos`;

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
    if (!selectedClassType || !customPreview) return null;
    const equivalentPlan = getEquivalentPlan(customPreview.credits, selectedClassType);
    if (!equivalentPlan) return null;
    return Math.abs(equivalentPlan.totalPriceCents - customPreview.totalPriceCents) <= 1 ? equivalentPlan : null;
  }, [selectedClassType, customPreview]);

  const comparisonRows = useMemo(() => {
    if (!selectedClassType) return [];
    const fixedPlans = getFixedPlansByClassType(selectedClassType);
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
  }, [selectedClassType]);

  const highlightedPurchase = lastPurchase || customPreview;
  const selectedFixedPlans = selectedClassType ? getFixedPlansByClassType(selectedClassType) : [];
  const baseFixedUnitPriceCents = selectedFixedPlans.length > 0 ? getFixedUnitPriceCents(selectedFixedPlans[0]) : 0;
  const primaryPlanIndex = selectedFixedPlans.findIndex((plan) => plan.badge === 'Mais escolhido' || !!plan.highlight);
  const focusedPlanIndex = highlightedPlanCredits
    ? selectedFixedPlans.findIndex((plan) => plan.credits === highlightedPlanCredits)
    : -1;

  const handlePurchase = (planData: PurchasePlanData, dbPlanId?: string) => {
    setLastPurchase(planData);

    if (dbPlanId) {
      if (usedCredits > planData.credits) {
        toast.error(`Este plano não pode ser aplicado agora, pois você já usou ${usedCredits} créditos no mês.`);
        return;
      }
      choosePlanMutation.mutate(dbPlanId);
      return;
    }

    toast.success('Resumo da compra preparado. Integracao com pagamento sera conectada na proxima etapa.');
  };

  const remaining = Math.max((credits?.monthly_limit || 0) - usedCredits, 0);

  const scrollToEquivalentPlan = (creditsToFocus: number) => {
    if (!selectedClassType) return;
    setHighlightedPlanCredits(creditsToFocus);
  };

  const handleClassTypeSelection = (classType: ClassType) => {
    setSelectedClassType(classType);
    setHighlightedPlanCredits(null);
  };

  return (
    <div className="space-y-4 p-4">
      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-display text-xl uppercase tracking-wider">Planos e créditos</h1>
            <p className="text-sm text-muted-foreground">Escolha o plano ideal para sua rotina e treine com constância.</p>
          </div>
          <div className="w-full sm:w-44">
            <Label className="mb-1 block text-xs text-muted-foreground">Mês de referência</Label>
            <Input
              type="month"
              value={monthInput}
              onChange={(e) => setMonthInput(e.target.value)}
              className="bg-background"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">
            Créditos: {usedCredits}/{credits?.monthly_limit || 0}
          </Badge>
          <Badge variant={remaining > 0 ? 'default' : 'outline'}>Restantes: {remaining}</Badge>
          {selectedPlan?.lesson_plans?.name && (
            <Badge variant="outline">Plano atual: {selectedPlan.lesson_plans.name}</Badge>
          )}
        </div>
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
          <div className="space-y-3">
            <div className="space-y-1">
              <h2 className="font-display text-base uppercase tracking-wider">
                {selectedClassType === 'individual' ? 'Planos fixos individuais' : 'Planos fixos em dupla'}
              </h2>
              <p className="text-sm text-muted-foreground">Quanto maior o pacote, melhor o valor por crédito.</p>
            </div>

            <PlanCarousel
              plans={selectedFixedPlans}
              getPlanKey={(plan) => `${selectedClassType}-${plan.credits}`}
              primaryPlanIndex={primaryPlanIndex >= 0 ? primaryPlanIndex : undefined}
              focusPlanIndex={focusedPlanIndex >= 0 ? focusedPlanIndex : undefined}
              renderPlanCard={(plan, _index, slideState) => {
                const unitPriceCents = getFixedUnitPriceCents(plan);
                const perStudentCents = unitPriceCents / 2;
                const dbPlan = selectedClassType === 'individual' ? dbIndividualPlansByCredits.get(plan.credits) : undefined;
                const isSelected = dbPlan ? selectedPlan?.plan_id === dbPlan.id : false;
                const cannotApply = usedCredits > plan.credits;
                const isApplying = dbPlan ? choosePlanMutation.isPending && choosePlanMutation.variables === dbPlan.id : false;
                const isDouble = selectedClassType === 'double';
                const isHighlighted = !!plan.highlight || highlightedPlanCredits === plan.credits;
                const isMainChosen = plan.badge === 'Mais escolhido';
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
                    } ${isMainChosen && slideState.isActive ? 'lg:scale-[1.02]' : ''}`}
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
                            <p className="font-medium text-foreground">{plan.validityDays} dias</p>
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
                          <p className="text-[11px] text-muted-foreground">em relação às aulas avulsas.</p>
                        </div>
                      )}

                      <p className="text-sm text-muted-foreground">{plan.description}</p>

                      {plan.note && <p className="text-xs text-muted-foreground">{plan.note}</p>}
                      {plan.reinforcement && <p className="text-xs font-medium text-primary">{plan.reinforcement}</p>}
                      {cannotApply && dbPlan && (
                        <p className="text-xs text-destructive">
                            Este plano não pode ser aplicado neste mês porque você já usou {usedCredits} créditos.
                          </p>
                        )}
                      </div>

                      <Button
                        onClick={() => handlePurchase(purchaseData, dbPlan?.id)}
                        disabled={isApplying || isSelected || (cannotApply && !!dbPlan)}
                        className="mt-auto w-full font-display uppercase tracking-wider"
                      >
                        {isSelected ? 'Plano atual' : isApplying ? 'Aplicando...' : 'Comprar créditos'}
                      </Button>
                    </div>
                  </div>
                );
              }}
            />
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
              <p className="text-xs text-muted-foreground">Mínimo 1 e máximo {MAX_CUSTOM_CREDITS} créditos.</p>
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
                      <p className="font-medium text-foreground">{customPreview.credits} créditos</p>
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
                      <p className="font-medium text-foreground">{customPreview.validityDays} dias</p>
                    </div>
                  </div>
                  {equivalentCustomFixedPlan && (
                    <div className="rounded-md border border-primary/40 bg-background/80 p-2">
                      <p className="text-xs font-medium text-primary">
                        Você está no mesmo valor do pacote de {equivalentCustomFixedPlan.credits} aulas.
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => scrollToEquivalentPlan(equivalentCustomFixedPlan.credits)}
                        className="mt-2"
                      >
                        Ver plano equivalente
                        <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>

            <Button
              onClick={() => customPreview && handlePurchase(customPreview)}
              className="w-full font-display uppercase tracking-wider sm:w-auto"
            >
              Comprar créditos
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
                  <p className="font-medium text-foreground">{highlightedPurchase.validityDays} dias</p>
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
