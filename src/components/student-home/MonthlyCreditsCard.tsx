import { CalendarDays } from 'lucide-react';
import AnimatedCard from './AnimatedCard';
import MonthlyCreditsRadialProgress from './MonthlyCreditsRadialProgress';

interface MonthlyCreditsCardProps {
  loading: boolean;
  hasError: boolean;
  used: number;
  total: number;
}

const MonthlyCreditsCard = ({ loading, hasError, used, total }: MonthlyCreditsCardProps) => {
  const safeTotal = Math.max(total, 0);
  const safeUsed = Math.max(used, 0);

  return (
    <AnimatedCard className="p-5 sm:p-6">
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Aulas do mês</p>
            <h2 className="mt-1 text-xl text-foreground sm:text-2xl">Progresso de utilização</h2>
          </div>
          <CalendarDays className="h-5 w-5 text-primary/80" />
        </div>

        {!loading && hasError && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4">
            <p className="text-sm font-medium text-destructive">Não foi possível carregar seu progresso de aulas.</p>
          </div>
        )}

        {(loading || !hasError) && (
          <MonthlyCreditsRadialProgress usedCredits={safeUsed} monthlyLimit={safeTotal} loading={loading} />
        )}
      </div>
    </AnimatedCard>
  );
};

export default MonthlyCreditsCard;
