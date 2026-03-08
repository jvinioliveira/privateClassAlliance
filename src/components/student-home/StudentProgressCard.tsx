import { Activity, Flame, Trophy } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import AnimatedCard from './AnimatedCard';
import StatPill from './StatPill';
import type { ProgressStats } from './types';

interface StudentProgressCardProps {
  loading: boolean;
  hasError: boolean;
  stats: ProgressStats;
}

const StudentProgressCard = ({ loading, hasError, stats }: StudentProgressCardProps) => {
  const monthRatio = stats.monthlyLimit > 0 ? stats.completedThisMonth / stats.monthlyLimit : 0;

  const rhythmCopy =
    stats.totalCompleted === 0
      ? 'Seu progresso será mostrado conforme suas aulas forem concluídas.'
      : monthRatio >= 0.75
      ? 'Bom ritmo neste mês.'
      : monthRatio >= 0.35
      ? 'Você está mantendo constância.'
      : 'Reserve um horário para manter a evolução.';

  return (
    <AnimatedCard className="p-5 sm:p-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Progresso do aluno</p>
            <h2 className="mt-1 text-lg text-foreground sm:text-xl">Evolução do treino</h2>
          </div>
          <Trophy className="h-5 w-5 text-primary/80" />
        </div>

        {loading && (
          <div className="space-y-2">
            <Skeleton className="h-[72px] rounded-xl bg-muted/70" />
            <Skeleton className="h-[72px] rounded-xl bg-muted/70" />
            <Skeleton className="h-[72px] rounded-xl bg-muted/70" />
          </div>
        )}

        {!loading && hasError && (
          <div className="rounded-xl border border-border/80 bg-background/35 p-4 text-sm text-muted-foreground">
            Não foi possível carregar as métricas de progresso agora.
          </div>
        )}

        {!loading && !hasError && (
          <>
            <div className="grid grid-cols-2 gap-2.5">
              <StatPill label="Total concluídas" value={stats.totalCompleted} tone="primary" />
              <StatPill label="Concluídas no mês" value={stats.completedThisMonth} tone="success" />
              <StatPill label="Sequência" value={stats.streakWeeks} suffix=" sem" />
              <StatPill label="Últimas 4 semanas" value={stats.recentFrequency} suffix=" aulas" />
            </div>

            <div className="space-y-1 rounded-xl border border-border/75 bg-background/35 p-3">
              <p className="text-sm text-foreground">
                Você já concluiu <span className="font-semibold text-primary">{stats.totalCompleted}</span> aula
                {stats.totalCompleted === 1 ? '' : 's'}.
              </p>
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Activity className="h-3.5 w-3.5 text-primary/80" />
                {rhythmCopy}
              </p>
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Flame className="h-3.5 w-3.5 text-primary/80" />
                Sua sequência atual é de {stats.streakWeeks} semana{stats.streakWeeks === 1 ? '' : 's'}.
              </p>
            </div>
          </>
        )}
      </div>
    </AnimatedCard>
  );
};

export default StudentProgressCard;
