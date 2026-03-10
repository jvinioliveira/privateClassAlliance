import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { ArrowLeft, Pencil, Plus } from 'lucide-react';

type LessonPlanRow = Database['public']['Tables']['lesson_plans']['Row'];
type PlanClassType = 'individual' | 'double';

const BASE_SINGLE_CLASS_CENTS = 10000;
const BASE_DOUBLE_CLASS_CENTS = 15000;

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
  const [pixCode, setPixCode] = useState('');
  const [pixQrImageUrl, setPixQrImageUrl] = useState('');
  const [creditPaymentUrl, setCreditPaymentUrl] = useState('');

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
      return data;
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
    setPixCode('');
    setPixQrImageUrl('');
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
    setPixCode(plan.pix_code || '');
    setPixQrImageUrl(plan.pix_qr_image_url || '');
    setCreditPaymentUrl(plan.credit_payment_url || '');
    setOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const normalized = priceReais.replace(',', '.');
      const parsedPrice = Number(normalized);
      const parsedCredits = Number(credits);
      const parsedSortOrder = Number(sortOrder);
      const normalizedCreditPaymentUrl = creditPaymentUrl.trim();
      const normalizedPixQrImageUrl = pixQrImageUrl.trim();
      const isPaymentUrlValid = !normalizedCreditPaymentUrl || /^https?:\/\//i.test(normalizedCreditPaymentUrl);
      const isPixQrUrlValid = !normalizedPixQrImageUrl || /^https?:\/\//i.test(normalizedPixQrImageUrl);

      if (!name.trim()) throw new Error('Informe o nome do plano.');
      if (!isPaymentUrlValid) throw new Error('Link de cartão deve começar com http:// ou https://.');
      if (!isPixQrUrlValid) throw new Error('URL do QR PIX deve começar com http:// ou https://.');
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
        pix_code: pixCode.trim() || null,
        pix_qr_image_url: normalizedPixQrImageUrl || null,
        credit_payment_url: normalizedCreditPaymentUrl || null,
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
      if ((err as unknown as { code?: string }).code === '23505') {
        toast.error('Plano duplicado para a mesma categoria, créditos e valor.');
        return;
      }
      toast.error(err.message);
    },
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

  const plansWithMetrics = useMemo(() => {
    return plans.map((plan) => {
      const planClassType = normalizePlanClassType(plan.class_type);
      const reference = planClassType === 'double' ? BASE_DOUBLE_CLASS_CENTS : BASE_SINGLE_CLASS_CENTS;
      const pricePerClass = plan.credits > 0 ? plan.price_cents / plan.credits : plan.price_cents;
      const discountPct = Math.max(0, Number((((reference - pricePerClass) / reference) * 100).toFixed(1)));

      return { ...plan, planClassType, pricePerClass, discountPct };
    });
  }, [plans]);

  const visiblePlans = useMemo(() => {
    if (!selectedManagementClassType) return [];
    return plansWithMetrics.filter((plan) => plan.planClassType === selectedManagementClassType);
  }, [plansWithMetrics, selectedManagementClassType]);

  const handleManageClassType = (nextType: PlanClassType) => {
    setSelectedManagementClassType(nextType);
  };

  const handleCreateForClassType = (nextType: PlanClassType) => {
    setSelectedManagementClassType(nextType);
    openCreate(nextType);
  };

  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl uppercase tracking-wider">Planos</h1>

      {!selectedManagementClassType ? (
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
                        <Badge variant={plan.is_active ? 'default' : 'outline'}>
                          {plan.is_active ? 'Ativo' : 'Inativo'}
                        </Badge>
                        <Badge variant="outline">{getClassTypeLabel(plan.planClassType)}</Badge>
                        <Badge variant="secondary">{plan.credits} Créditos</Badge>
                      </div>
                      {plan.description && <p className="text-sm text-muted-foreground">{plan.description}</p>}
                      <p className="text-sm text-foreground">
                        Total: <strong>{formatMoney(plan.price_cents)}</strong> (
                        {formatMoney(Math.round(plan.planClassType === 'double' ? plan.pricePerClass / 2 : plan.pricePerClass))}{' '}
                        {plan.planClassType === 'double' ? 'por aluno' : 'por aula'})
                      </p>
                      {plan.discountPct > 0 && (
                        <p className="text-xs text-primary">Desconto aproximado: {plan.discountPct}%</p>
                      )}
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Badge variant={plan.pix_code ? 'default' : 'outline'}>
                          {plan.pix_code ? 'PIX configurado' : 'PIX pendente'}
                        </Badge>
                        <Badge variant={plan.credit_payment_url ? 'default' : 'outline'}>
                          {plan.credit_payment_url ? 'Cartão configurado' : 'Cartão pendente'}
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
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Pacote 8 aulas"
                className="bg-background"
              />
            </div>

            <div className="space-y-1">
              <Label>Descrição</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Resumo do plano"
                className="bg-background"
              />
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
                <Input
                  type="number"
                  min={1}
                  value={credits}
                  onChange={(e) => setCredits(Number(e.target.value))}
                  className="bg-background"
                />
              </div>
              <div className="space-y-1">
                <Label>Valor total (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={priceReais}
                  onChange={(e) => setPriceReais(e.target.value)}
                  className="bg-background"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Ordem</Label>
                <Input
                  type="number"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(Number(e.target.value))}
                  className="bg-background"
                />
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
              <Label>Código PIX (copia e cola)</Label>
              <Textarea
                value={pixCode}
                onChange={(e) => setPixCode(e.target.value)}
                placeholder="Cole aqui o código PIX deste plano"
                className="min-h-24 bg-background"
              />
            </div>

            <div className="space-y-1">
              <Label>URL do QR Code PIX (opcional)</Label>
              <Input
                value={pixQrImageUrl}
                onChange={(e) => setPixQrImageUrl(e.target.value)}
                placeholder="https://..."
                className="bg-background"
              />
            </div>

            <div className="space-y-1">
              <Label>Link de pagamento no cartão (opcional)</Label>
              <Input
                value={creditPaymentUrl}
                onChange={(e) => setCreditPaymentUrl(e.target.value)}
                placeholder="https://..."
                className="bg-background"
              />
            </div>

            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="w-full font-display uppercase tracking-wider"
            >
              {saveMutation.isPending ? 'Salvando...' : editingPlan ? 'Salvar alterações' : 'Criar plano'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminPlansPage;



