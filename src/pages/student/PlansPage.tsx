import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

type LessonPlanRow = Database['public']['Tables']['lesson_plans']['Row'];

const BASE_SINGLE_CLASS_CENTS = 10000;

const formatMoney = (cents: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
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

const PlansPage = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [monthInput, setMonthInput] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const monthRef = `${monthInput}-01`;

  const { data: plans = [], isLoading } = useQuery({
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
      return data as
        | {
            id: string;
            plan_id: string;
            month_ref: string;
            credits: number;
            price_cents: number;
            lesson_plans: { name: string; description: string | null } | null;
          }
        | null;
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

  const remaining = Math.max((credits?.monthly_limit || 0) - usedCredits, 0);

  return (
    <div className="space-y-4 p-4">
      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="font-display text-xl uppercase tracking-wider">Planos e creditos</h1>
          <div className="w-full sm:w-44">
            <Label className="mb-1 block text-xs text-muted-foreground">Mes de referencia</Label>
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
            Creditos: {usedCredits}/{credits?.monthly_limit || 0}
          </Badge>
          <Badge variant={remaining > 0 ? 'default' : 'outline'}>Restantes: {remaining}</Badge>
          {selectedPlan?.lesson_plans?.name && (
            <Badge variant="outline">Plano atual: {selectedPlan.lesson_plans.name}</Badge>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : plans.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-muted-foreground">Nenhum plano disponivel.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {plans.map((plan) => {
            const pricePerClass = Math.round(plan.price_cents / plan.credits);
            const discountPct = Math.max(
              0,
              Number((((BASE_SINGLE_CLASS_CENTS - pricePerClass) / BASE_SINGLE_CLASS_CENTS) * 100).toFixed(1)),
            );
            const isSelected = selectedPlan?.plan_id === plan.id;
            const cannotSelect = usedCredits > plan.credits;

            return (
              <div key={plan.id} className="rounded-xl border border-border bg-card p-4 animate-fade-in">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-base font-medium text-foreground">{plan.name}</p>
                      <Badge variant="secondary">{plan.credits} creditos</Badge>
                      {isSelected && <Badge variant="default">Selecionado</Badge>}
                    </div>
                    {plan.description && (
                      <p className="text-sm text-muted-foreground">{plan.description}</p>
                    )}
                    <p className="text-sm text-foreground">
                      {formatMoney(plan.price_cents)} total ({formatMoney(pricePerClass)} por aula)
                    </p>
                    {discountPct > 0 && (
                      <p className="text-xs text-primary">Desconto aproximado: {discountPct}%</p>
                    )}
                    {cannotSelect && (
                      <p className="text-xs text-destructive">
                        Este plano nao pode ser aplicado porque voce ja usou {usedCredits} creditos no mes.
                      </p>
                    )}
                  </div>

                  <Button
                    onClick={() => choosePlanMutation.mutate(plan.id)}
                    disabled={choosePlanMutation.isPending || isSelected || cannotSelect}
                    className="w-full font-display uppercase tracking-wider sm:w-auto"
                  >
                    {isSelected ? 'Plano atual' : choosePlanMutation.isPending ? 'Aplicando...' : 'Escolher plano'}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PlansPage;
