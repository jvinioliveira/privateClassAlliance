import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { ArrowLeft, Pencil, Plus } from 'lucide-react';

type LessonPlanRow = Database['public']['Tables']['lesson_plans']['Row'];
type PlanClassType = 'individual' | 'double';
type PlanWithMetrics = LessonPlanRow & {
  planClassType: PlanClassType;
  pricePerClass: number;
  discountPct: number;
};

const BASE_SINGLE_CLASS_CENTS = 10000;
const BASE_DOUBLE_CLASS_CENTS = 15000;
const PAYMENT_LINK_VALIDITY_DAYS = 30;
const PAYMENT_LINK_WARNING_DAYS = 7;

type PaymentLinkWarning = {
  badgeVariant: 'secondary' | 'destructive';
  label: string;
  details: string;
};

const normalizePlanClassType = (rawValue: unknown): PlanClassType => {
  if (rawValue === 'double') return 'double';
  return 'individual';
};

const getClassTypeLabel = (classType: PlanClassType) => (classType === 'individual' ? 'Individual' : 'Dupla');

const formatMoney = (cents: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100);

const formatDayCount = (days: number) => `${days} ${days === 1 ? 'dia' : 'dias'}`;

const getPaymentLinkWarning = (plan: Pick<LessonPlanRow, 'credit_payment_url' | 'updated_at'>): PaymentLinkWarning | null => {
  if (!plan.credit_payment_url) return null;

  const updatedAtMs = Date.parse(plan.updated_at);
  if (!Number.isFinite(updatedAtMs)) {
    return {
      badgeVariant: 'secondary',
      label: 'Validade do link indisponível',
      details: 'Não foi possível calcular o prazo deste link.',
    };
  }

  const dayMs = 24 * 60 * 60 * 1000;
  const elapsedDays = Math.max(0, Math.floor((Date.now() - updatedAtMs) / dayMs));
  const remainingDays = PAYMENT_LINK_VALIDITY_DAYS - elapsedDays;

  if (remainingDays <= 0) {
    return {
      badgeVariant: 'destructive',
      label: 'Link NuPay possivelmente expirado',
      details: `Última atualização há ${formatDayCount(elapsedDays)}.`,
    };
  }

  if (remainingDays <= PAYMENT_LINK_WARNING_DAYS) {
    return {
      badgeVariant: 'secondary',
      label: `Link NuPay expira em ${formatDayCount(remainingDays)}`,
      details: `Última atualização há ${formatDayCount(elapsedDays)}.`,
    };
  }

  return null;
};

const AdminPlansPage = () => {
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [selectedManagementClassType, setSelectedManagementClassType] = useState<PlanClassType | null>(null);
  const [editingPlan, setEditingPlan] = useState<LessonPlanRow | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [classType, setClassType] = useState<PlanClassType>('individual');
  const [credits, setCredits] = useState(1);
  const [priceReais, setPriceReais] = useState('100.00');
  const [sortOrder, setSortOrder] = useState(0);
  const [isActive, setIsActive] = useState(true);
  const [creditPaymentUrl, setCreditPaymentUrl] = useState('');

  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentPlan, setPaymentPlan] = useState<PlanWithMetrics | null>(null);
  const [paymentCreditPaymentUrl, setPaymentCreditPaymentUrl] = useState('');
  const [selectedPaymentClassType, setSelectedPaymentClassType] = useState<PlanClassType | null>(null);

  const { data: plans = [], isLoading } = useQuery({
    queryKey: ['admin-lesson-plans'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lesson_plans')
        .select('*')
        .order('class_type', { ascending: true })
        .order('sort_order', { ascending: true })
        .order('credits', { ascending: true });

      if (error) throw error;
      return data as LessonPlanRow[];
    },
  });

  const resetForm = () => {
    setEditingPlan(null);
    setName('');
    setDescription('');
    setClassType('individual');
    setCredits(1);
    setPriceReais('100.00');
    setSortOrder(0);
    setIsActive(true);
    setCreditPaymentUrl('');
  };

  const openCreate = (presetClassType?: PlanClassType) => {
    resetForm();
    if (presetClassType) setClassType(presetClassType);
    setOpen(true);
  };

  const openEdit = (plan: LessonPlanRow) => {
    setEditingPlan(plan);
    setName(plan.name);
    setDescription(plan.description || '');
    setClassType(normalizePlanClassType(plan.class_type));
    setCredits(plan.credits);
    setPriceReais((plan.price_cents / 100).toFixed(2));
    setSortOrder(plan.sort_order);
    setIsActive(plan.is_active);
    setCreditPaymentUrl(plan.credit_payment_url || '');
    setOpen(true);
  };

  const openPaymentDialog = (plan: PlanWithMetrics) => {
    setPaymentPlan(plan);
    setPaymentCreditPaymentUrl(plan.credit_payment_url || '');
    setPaymentDialogOpen(true);
  };

  const closePaymentDialog = () => {
    setPaymentDialogOpen(false);
    setPaymentPlan(null);
    setPaymentCreditPaymentUrl('');
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const normalized = priceReais.replace(',', '.');
      const parsedPrice = Number(normalized);
      const parsedCredits = Number(credits);
      const parsedSortOrder = Number(sortOrder);
      const normalizedCreditPaymentUrl = creditPaymentUrl.trim();
      const isPaymentUrlValid = /^https?:\/\//i.test(normalizedCreditPaymentUrl);

      if (!name.trim()) throw new Error('Informe o nome do plano.');
      if (!normalizedCreditPaymentUrl) throw new Error('Informe o link de pagamento NuPay.');
      if (!isPaymentUrlValid) throw new Error('Link NuPay deve começar com http:// ou https://.');
      if (!Number.isFinite(parsedPrice) || parsedPrice < 0) throw new Error('Valor inválido.');
      if (!Number.isInteger(parsedCredits) || parsedCredits <= 0) {
        throw new Error('Créditos devem ser inteiros e maiores que zero.');
      }
      if (!Number.isFinite(parsedSortOrder)) throw new Error('Ordem inválida.');

      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        class_type: classType,
        credits: parsedCredits,
        price_cents: Math.round(parsedPrice * 100),
        sort_order: Math.trunc(parsedSortOrder),
        is_active: isActive,
        pix_code: null,
        pix_qr_image_url: null,
        credit_payment_url: normalizedCreditPaymentUrl,
      };

      const duplicateQuery = supabase
        .from('lesson_plans')
        .select('id')
        .eq('class_type', classType)
        .eq('credits', parsedCredits)
        .eq('price_cents', payload.price_cents)
        .limit(1);

      if (editingPlan) duplicateQuery.neq('id', editingPlan.id);

      const { data: duplicate, error: duplicateError } = await duplicateQuery.maybeSingle();
      if (duplicateError) throw duplicateError;
      if (duplicate) {
        throw new Error(
          `Já existe um plano ${getClassTypeLabel(classType).toLowerCase()} com ${parsedCredits} créditos e valor ${formatMoney(payload.price_cents)}.`,
        );
      }

      if (editingPlan) {
        const { error } = await supabase.from('lesson_plans').update(payload).eq('id', editingPlan.id);
        if (error) throw error;
        return;
      }

      const { error } = await supabase.from('lesson_plans').insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(editingPlan ? 'Plano atualizado.' : 'Plano criado.');
      setOpen(false);
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['admin-lesson-plans'] });
      queryClient.invalidateQueries({ queryKey: ['student-lesson-plans'] });
    },
    onError: (err: Error) => {
      if ((err as { code?: string }).code === '23505') {
        toast.error('Plano duplicado para a mesma categoria, créditos e valor.');
        return;
      }
      toast.error(err.message);
    },
  });

  const savePaymentConfigMutation = useMutation({
    mutationFn: async () => {
      if (!paymentPlan) throw new Error('Plano inválido para configuração de pagamento.');

      const normalizedCreditPaymentUrl = paymentCreditPaymentUrl.trim();
      const isCreditUrlValid = /^https?:\/\//i.test(normalizedCreditPaymentUrl);

      if (!normalizedCreditPaymentUrl) throw new Error('Informe o link de pagamento NuPay.');
      if (!isCreditUrlValid) throw new Error('Link NuPay deve começar com http:// ou https://.');

      const payload = {
        pix_code: null,
        pix_qr_image_url: null,
        credit_payment_url: normalizedCreditPaymentUrl,
      };

      const { error } = await supabase.from('lesson_plans').update(payload).eq('id', paymentPlan.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Configuração de pagamento salva.');
      closePaymentDialog();
      queryClient.invalidateQueries({ queryKey: ['admin-lesson-plans'] });
      queryClient.invalidateQueries({ queryKey: ['student-lesson-plans'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async (plan: LessonPlanRow) => {
      const { error } = await supabase.from('lesson_plans').update({ is_active: !plan.is_active }).eq('id', plan.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-lesson-plans'] });
      queryClient.invalidateQueries({ queryKey: ['student-lesson-plans'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const plansWithMetrics = useMemo<PlanWithMetrics[]>(() => {
    return plans.map((plan) => {
      const planClassType = normalizePlanClassType(plan.class_type);
      const reference = planClassType === 'double' ? BASE_DOUBLE_CLASS_CENTS : BASE_SINGLE_CLASS_CENTS;
      const pricePerClass = plan.credits > 0 ? plan.price_cents / plan.credits : plan.price_cents;
      const discountPct = Math.max(0, Number((((reference - pricePerClass) / reference) * 100).toFixed(1)));

      return { ...plan, planClassType, pricePerClass, discountPct };
    });
  }, [plans]);

  const visiblePlans = useMemo(() => {
    if (!selectedManagementClassType) return [] as PlanWithMetrics[];
    return plansWithMetrics.filter((plan) => plan.planClassType === selectedManagementClassType);
  }, [plansWithMetrics, selectedManagementClassType]);

  const paymentPlans = useMemo(
    () =>
      [...plansWithMetrics].sort(
        (a, b) => a.planClassType.localeCompare(b.planClassType) || a.sort_order - b.sort_order || a.credits - b.credits,
      ),
    [plansWithMetrics],
  );
  const visiblePaymentPlans = useMemo(() => {
    if (!selectedPaymentClassType) return [] as PlanWithMetrics[];
    return paymentPlans.filter((plan) => plan.planClassType === selectedPaymentClassType);
  }, [paymentPlans, selectedPaymentClassType]);

  const handleManageClassType = (nextType: PlanClassType) => {
    setSelectedManagementClassType(nextType);
  };

  const handleCreateForClassType = (nextType: PlanClassType) => {
    setSelectedManagementClassType(nextType);
    openCreate(nextType);
  };

  const renderPaymentPlanOption = (plan: PlanWithMetrics) => {
    const paymentLinkWarning = getPaymentLinkWarning(plan);

    return (
      <div key={`payment-option-${plan.id}`} className="rounded-lg border border-border/70 bg-background/40 p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-foreground">{plan.name}</p>
              <Badge variant="outline">{getClassTypeLabel(plan.planClassType)}</Badge>
              <Badge variant="secondary">{plan.credits} créditos</Badge>
            </div>
            <p className="text-xs text-muted-foreground">Valor pré-definido: {formatMoney(plan.price_cents)}</p>
            <div className="flex flex-wrap gap-2">
              <Badge variant={plan.credit_payment_url ? 'default' : 'outline'}>
                {plan.credit_payment_url ? 'NuPay configurado' : 'NuPay pendente'}
              </Badge>
              {paymentLinkWarning && <Badge variant={paymentLinkWarning.badgeVariant}>{paymentLinkWarning.label}</Badge>}
            </div>
            {paymentLinkWarning && <p className="text-[11px] text-muted-foreground">{paymentLinkWarning.details}</p>}
          </div>
          <Button size="sm" onClick={() => openPaymentDialog(plan)}>
            Configurar pagamento
          </Button>
        </div>
      </div>
    );
  };

  const paymentPlanWarning = paymentPlan ? getPaymentLinkWarning(paymentPlan) : null;

  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl uppercase tracking-wider">Planos</h1>

      {!selectedManagementClassType ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-sm font-medium text-foreground">Planos individuais</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Escolha esta categoria para listar, editar e criar planos de aula individual.
              </p>
              <div className="mt-3 flex gap-2">
                <Button variant="outline" onClick={() => handleManageClassType('individual')}>
                  Gerenciar
                </Button>
                <Button onClick={() => handleCreateForClassType('individual')}>Novo individual</Button>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-sm font-medium text-foreground">Planos em dupla</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Escolha esta categoria para listar, editar e criar planos de aula em dupla.
              </p>
              <div className="mt-3 flex gap-2">
                <Button variant="outline" onClick={() => handleManageClassType('double')}>
                  Gerenciar
                </Button>
                <Button onClick={() => handleCreateForClassType('double')}>Novo em dupla</Button>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card px-4">
            <Accordion type="single" collapsible>
              <AccordionItem value="payment-center" className="border-none">
                <AccordionTrigger className="py-4 font-display text-sm uppercase tracking-wider">
                  Central de pagamento por plano
                </AccordionTrigger>
                <AccordionContent className="pb-4">
                  <p className="text-sm text-muted-foreground">
                    Clique em um plano para abrir o modal e configurar o link de pagamento NuPay.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant={selectedPaymentClassType === 'individual' ? 'default' : 'outline'}
                      onClick={() => setSelectedPaymentClassType('individual')}
                    >
                      Planos individuais
                    </Button>
                    <Button
                      type="button"
                      variant={selectedPaymentClassType === 'double' ? 'default' : 'outline'}
                      onClick={() => setSelectedPaymentClassType('double')}
                    >
                      Planos em dupla
                    </Button>
                    {selectedPaymentClassType && (
                      <Button type="button" variant="ghost" onClick={() => setSelectedPaymentClassType(null)}>
                        Recolher lista
                      </Button>
                    )}
                  </div>

                  {isLoading ? (
                    <div className="flex justify-center py-6">
                      <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    </div>
                  ) : paymentPlans.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">Nenhum plano cadastrado ainda.</p>
                  ) : !selectedPaymentClassType ? (
                    <p className="mt-3 text-sm text-muted-foreground">
                      Selecione uma categoria para visualizar e configurar os planos.
                    </p>
                  ) : visiblePaymentPlans.length === 0 ? (
                    <p className="mt-3 text-sm text-muted-foreground">
                      Nenhum plano {selectedPaymentClassType === 'individual' ? 'individual' : 'em dupla'} cadastrado.
                    </p>
                  ) : (
                    <div className="mt-3 space-y-4">
                      <div className="rounded-xl border border-border/70 bg-background/30 p-3">
                        <h3 className="font-display text-xs uppercase tracking-wider text-foreground">
                          {selectedPaymentClassType === 'individual' ? 'Planos individuais' : 'Planos em dupla'}
                        </h3>
                        <div className="mt-2 space-y-2">{visiblePaymentPlans.map(renderPaymentPlanOption)}</div>
                      </div>
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                Gerenciando: <span className="font-medium text-foreground">{getClassTypeLabel(selectedManagementClassType)}</span>
              </p>
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-fit border-border/60 bg-background/40 px-2.5 text-xs text-muted-foreground hover:bg-background"
                onClick={() => setSelectedManagementClassType(null)}
              >
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                Voltar
              </Button>
            </div>

            <Button
              onClick={() => openCreate(selectedManagementClassType)}
              className="w-full font-display uppercase tracking-wider sm:w-auto"
            >
              <Plus className="mr-1 h-4 w-4" /> Novo plano
            </Button>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-10">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : visiblePlans.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-8 text-center">
              <p className="text-muted-foreground">Nenhum plano cadastrado nesta categoria.</p>
              <Button className="mt-3" onClick={() => openCreate(selectedManagementClassType)}>
                <Plus className="mr-1 h-4 w-4" />
                Criar primeiro plano
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {visiblePlans.map((plan) => (
                <div key={plan.id} className="rounded-xl border border-border bg-card p-4 animate-fade-in">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-base font-medium text-foreground">{plan.name}</p>
                        <Badge variant={plan.is_active ? 'default' : 'outline'}>{plan.is_active ? 'Ativo' : 'Inativo'}</Badge>
                        <Badge variant="outline">{getClassTypeLabel(plan.planClassType)}</Badge>
                        <Badge variant="secondary">{plan.credits} créditos</Badge>
                      </div>
                      {plan.description && <p className="text-sm text-muted-foreground">{plan.description}</p>}
                      <p className="text-sm text-foreground">
                        Total: <strong>{formatMoney(plan.price_cents)}</strong> (
                        {formatMoney(Math.round(plan.planClassType === 'double' ? plan.pricePerClass / 2 : plan.pricePerClass))}{' '}
                        {plan.planClassType === 'double' ? 'por aluno' : 'por aula'})
                      </p>
                      {plan.discountPct > 0 && <p className="text-xs text-primary">Desconto aproximado: {plan.discountPct}%</p>}
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Badge variant={plan.credit_payment_url ? 'default' : 'outline'}>
                          {plan.credit_payment_url ? 'NuPay configurado' : 'NuPay pendente'}
                        </Badge>
                      </div>
                    </div>

                    <div className="flex gap-2 self-end sm:self-auto">
                      <Button variant="outline" size="sm" onClick={() => openEdit(plan)}>
                        <Pencil className="mr-1 h-3.5 w-3.5" />
                        Editar
                      </Button>
                      <Button
                        size="sm"
                        variant={plan.is_active ? 'secondary' : 'default'}
                        onClick={() => toggleActiveMutation.mutate(plan)}
                        disabled={toggleActiveMutation.isPending}
                      >
                        {plan.is_active ? 'Desativar' : 'Ativar'}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) resetForm();
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto border-border bg-card sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display uppercase tracking-wider">
              {editingPlan ? 'Editar plano' : 'Novo plano'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Nome do plano</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Pacote 8 aulas" className="bg-background" />
            </div>

            <div className="space-y-1">
              <Label>Descrição</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Resumo do plano" className="bg-background" />
            </div>

            <div className="space-y-2">
              <Label>Categoria do plano</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={classType === 'individual' ? 'default' : 'outline'}
                  className="font-display uppercase tracking-wider"
                  onClick={() => setClassType('individual')}
                >
                  Individual
                </Button>
                <Button
                  type="button"
                  variant={classType === 'double' ? 'default' : 'outline'}
                  className="font-display uppercase tracking-wider"
                  onClick={() => setClassType('double')}
                >
                  Dupla
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Créditos</Label>
                <Input type="number" min={1} value={credits} onChange={(e) => setCredits(Number(e.target.value))} className="bg-background" />
              </div>
              <div className="space-y-1">
                <Label>Valor total (R$)</Label>
                <Input type="number" step="0.01" min={0} value={priceReais} onChange={(e) => setPriceReais(e.target.value)} className="bg-background" />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Ordem</Label>
                <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} className="bg-background" />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <Label htmlFor="plan-active" className="text-sm">
                  Plano ativo
                </Label>
                <input
                  id="plan-active"
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-4 w-4"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Link de pagamento NuPay (Nubank) (obrigatório)</Label>
              <Input value={creditPaymentUrl} onChange={(e) => setCreditPaymentUrl(e.target.value)} placeholder="https://..." className="bg-background" />
            </div>

            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="w-full font-display uppercase tracking-wider">
              {saveMutation.isPending ? 'Salvando...' : editingPlan ? 'Salvar alterações' : 'Criar plano'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={paymentDialogOpen}
        onOpenChange={(nextOpen) => {
          setPaymentDialogOpen(nextOpen);
          if (!nextOpen) closePaymentDialog();
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto border-border bg-card sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display uppercase tracking-wider">Configurar pagamento do plano</DialogTitle>
          </DialogHeader>

          {paymentPlan ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-border/70 bg-background/50 p-3">
                <p className="text-sm font-medium text-foreground">{paymentPlan.name}</p>
                <p className="text-xs text-muted-foreground">
                  {getClassTypeLabel(paymentPlan.planClassType)} • {paymentPlan.credits} créditos • {formatMoney(paymentPlan.price_cents)}
                </p>
              </div>

              {paymentPlanWarning && (
                <div className="rounded-lg border border-border/70 bg-background/50 p-3">
                  <Badge variant={paymentPlanWarning.badgeVariant}>{paymentPlanWarning.label}</Badge>
                  <p className="mt-2 text-xs text-muted-foreground">{paymentPlanWarning.details}</p>
                </div>
              )}

              <div className="space-y-1">
                <Label>Link de pagamento NuPay (Nubank) (obrigatório)</Label>
                <Input
                  value={paymentCreditPaymentUrl}
                  onChange={(e) => setPaymentCreditPaymentUrl(e.target.value)}
                  placeholder="https://..."
                  className="bg-background"
                />
              </div>

              <div className="flex gap-2">
                <Button variant="outline" className="w-full" onClick={closePaymentDialog} disabled={savePaymentConfigMutation.isPending}>
                  Cancelar
                </Button>
                <Button className="w-full" onClick={() => savePaymentConfigMutation.mutate()} disabled={savePaymentConfigMutation.isPending}>
                  {savePaymentConfigMutation.isPending ? 'Salvando...' : 'Salvar configuração'}
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Selecione um plano para configurar.</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminPlansPage;

