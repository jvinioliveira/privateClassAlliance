import { animate, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { CalendarDays } from 'lucide-react';
import AnimatedCard from './AnimatedCard';

interface MonthlyCreditsCardProps {
  loading: boolean;
  hasError: boolean;
  used: number;
  total: number;
}

const MonthlyCreditsCard = ({ loading, hasError, used, total }: MonthlyCreditsCardProps) => {
  const safeTotal = Math.max(total, 0);
  const safeUsed = Math.max(used, 0);
  const remaining = Math.max(safeTotal - safeUsed, 0);
  const progressTarget = safeTotal > 0 ? Math.min((safeUsed / safeTotal) * 100, 100) : 0;

  const [animatedProgress, setAnimatedProgress] = useState(0);
  const [animatedUsed, setAnimatedUsed] = useState(0);

  useEffect(() => {
    const controls = animate(0, progressTarget, {
      duration: 0.9,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => setAnimatedProgress(latest),
    });

    return () => controls.stop();
  }, [progressTarget]);

  useEffect(() => {
    const controls = animate(0, safeUsed, {
      duration: 0.85,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => setAnimatedUsed(Math.round(latest)),
    });

    return () => controls.stop();
  }, [safeUsed]);

  return (
    <AnimatedCard className="p-5 sm:p-6">
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Créditos ativos</p>
            <h2 className="mt-1 text-xl text-foreground sm:text-2xl">Saldo e uso dos créditos</h2>
          </div>
          <CalendarDays className="h-5 w-5 text-primary/80" />
        </div>

        {loading && (
          <div className="space-y-3">
            <Skeleton className="h-7 w-36 rounded-md bg-muted/70" />
            <Skeleton className="h-2.5 w-full rounded-full bg-muted/70" />
            <Skeleton className="h-4 w-52 rounded-md bg-muted/70" />
          </div>
        )}

        {!loading && hasError && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4">
            <p className="text-sm font-medium text-destructive">Não foi possível carregar seus créditos ativos.</p>
          </div>
        )}

        {!loading && !hasError && (
          <div className="space-y-3.5">
            <p className="text-[1.7rem] font-semibold leading-none text-foreground sm:text-[1.95rem]">
              <span className="text-primary">{animatedUsed}</span> de {safeTotal} utilizadas
            </p>

            <div className="h-2.5 overflow-hidden rounded-full bg-muted/80">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-primary/80 to-primary"
                style={{ width: `${animatedProgress}%` }}
              />
            </div>

            <p className="text-sm text-muted-foreground">
              {safeTotal === 0
                ? 'Você ainda não possui créditos ativos.'
                : remaining > 0
                ? `Você ainda pode agendar ${remaining} aula${remaining > 1 ? 's' : ''} com o saldo ativo.`
                : 'Você já utilizou todos os créditos ativos.'}
            </p>
          </div>
        )}
      </div>
    </AnimatedCard>
  );
};

export default MonthlyCreditsCard;
