import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Pencil, Plus } from 'lucide-react';

type LessonPlanRow = Database['public']['Tables']['lesson_plans']['Row'];

const BASE_SINGLE_CLASS_CENTS = 10000;

const formatMoney = (cents: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(cents / 100);

const AdminPlansPage = () => {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<LessonPlanRow | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [credits, setCredits] = useState(1);
  const [priceReais, setPriceReais] = useState('100.00');
  const [sortOrder, setSortOrder] = useState(0);
  const [isActive, setIsActive] = useState(true);

  const { data: plans = [], isLoading } = useQuery({
    queryKey: ['admin-lesson-plans'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lesson_plans')
        .select('*')
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
    setCredits(1);
    setPriceReais('100.00');
    setSortOrder(0);
    setIsActive(true);
  };

  const openCreate = () => {
    resetForm();
    setOpen(true);
  };

  const openEdit = (plan: LessonPlanRow) => {
    setEditingPlan(plan);
    setName(plan.name);
    setDescription(plan.description || '');
    setCredits(plan.credits);
    setPriceReais((plan.price_cents / 100).toFixed(2));
    setSortOrder(plan.sort_order);
    setIsActive(plan.is_active);
    setOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const normalized = priceReais.replace(',', '.');
      const parsedPrice = Number(normalized);
      const parsedCredits = Number(credits);
      const parsedSortOrder = Number(sortOrder);

      if (!name.trim()) throw new Error('Informe o nome do plano.');
      if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
        throw new Error('Valor invalido.');
      }
      if (!Number.isInteger(parsedCredits) || parsedCredits <= 0) {
        throw new Error('Creditos devem ser inteiros e maiores que zero.');
      }
      if (!Number.isFinite(parsedSortOrder)) {
        throw new Error('Ordem invalida.');
      }

      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        credits: parsedCredits,
        price_cents: Math.round(parsedPrice * 100),
        sort_order: Math.trunc(parsedSortOrder),
        is_active: isActive,
      };

      if (editingPlan) {
        const { error } = await supabase
          .from('lesson_plans')
          .update(payload)
          .eq('id', editingPlan.id);
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
    onError: (err: Error) => toast.error(err.message),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async (plan: LessonPlanRow) => {
      const { error } = await supabase
        .from('lesson_plans')
        .update({ is_active: !plan.is_active })
        .eq('id', plan.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-lesson-plans'] });
      queryClient.invalidateQueries({ queryKey: ['student-lesson-plans'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const plansWithMetrics = useMemo(
    () =>
      plans.map((plan) => {
        const pricePerClass = plan.credits > 0 ? plan.price_cents / plan.credits : plan.price_cents;
        const discountPct = Math.max(
          0,
          Number((((BASE_SINGLE_CLASS_CENTS - pricePerClass) / BASE_SINGLE_CLASS_CENTS) * 100).toFixed(1)),
        );
        return { ...plan, pricePerClass, discountPct };
      }),
    [plans],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="font-display text-xl uppercase tracking-wider">Planos</h1>
        <Dialog
          open={open}
          onOpenChange={(nextOpen) => {
            setOpen(nextOpen);
            if (!nextOpen) resetForm();
          }}
        >
          <DialogTrigger asChild>
            <Button onClick={openCreate} className="w-full font-display uppercase tracking-wider sm:w-auto">
              <Plus className="mr-1 h-4 w-4" /> Novo plano
            </Button>
          </DialogTrigger>
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
                <Label>Descricao</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Resumo do plano"
                  className="bg-background"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>Creditos</Label>
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

              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="w-full font-display uppercase tracking-wider"
              >
                {saveMutation.isPending ? 'Salvando...' : editingPlan ? 'Salvar alteracoes' : 'Criar plano'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : plansWithMetrics.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-muted-foreground">Nenhum plano cadastrado.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {plansWithMetrics.map((plan) => (
            <div key={plan.id} className="rounded-xl border border-border bg-card p-4 animate-fade-in">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-base font-medium text-foreground">{plan.name}</p>
                    <Badge variant={plan.is_active ? 'default' : 'outline'}>
                      {plan.is_active ? 'Ativo' : 'Inativo'}
                    </Badge>
                    <Badge variant="secondary">{plan.credits} creditos</Badge>
                  </div>
                  {plan.description && (
                    <p className="text-sm text-muted-foreground">{plan.description}</p>
                  )}
                  <p className="text-sm text-foreground">
                    Total: <strong>{formatMoney(plan.price_cents)}</strong> (
                    {formatMoney(Math.round(plan.pricePerClass))} por aula)
                  </p>
                  {plan.discountPct > 0 && (
                    <p className="text-xs text-primary">Desconto aproximado: {plan.discountPct}%</p>
                  )}
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
    </div>
  );
};

export default AdminPlansPage;
