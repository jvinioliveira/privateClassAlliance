import { animate, motion } from 'framer-motion';
import { useEffect, useId, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface MonthlyCreditsRadialProgressProps {
  usedCredits: number;
  monthlyLimit: number;
  loading?: boolean;
  className?: string;
}

const MonthlyCreditsRadialProgress = ({
  usedCredits,
  monthlyLimit,
  loading = false,
  className,
}: MonthlyCreditsRadialProgressProps) => {
  const safeUsed = Math.max(usedCredits, 0);
  const safeLimit = Math.max(monthlyLimit, 0);
  const remaining = Math.max(safeLimit - safeUsed, 0);
  const progressTarget = safeLimit > 0 ? Math.min(safeUsed / safeLimit, 1) : 0;

  const [animatedUsed, setAnimatedUsed] = useState(0);
  const [animatedPercent, setAnimatedPercent] = useState(0);
  const gradientId = useId();

  useEffect(() => {
    if (loading) return;

    const controls = animate(0, safeUsed, {
      duration: 0.85,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (value) => setAnimatedUsed(Math.round(value)),
    });

    return () => controls.stop();
  }, [loading, safeUsed]);

  useEffect(() => {
    if (loading) return;

    const controls = animate(0, progressTarget * 100, {
      duration: 0.95,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (value) => setAnimatedPercent(Math.round(value)),
    });

    return () => controls.stop();
  }, [loading, progressTarget]);

  if (loading) {
    return (
      <div className={cn('mx-auto flex w-full max-w-[210px] flex-col items-center gap-3', className)}>
        <Skeleton className="h-[170px] w-[170px] rounded-full bg-muted/70" />
        <Skeleton className="h-4 w-32 rounded-md bg-muted/70" />
        <Skeleton className="h-3 w-36 rounded-md bg-muted/70" />
      </div>
    );
  }

  return (
    <motion.div
      whileHover={{ y: -1.5, scale: 1.01 }}
      whileTap={{ scale: 0.995 }}
      className={cn('mx-auto flex w-full max-w-[210px] flex-col items-center gap-3', className)}
    >
      <div className="relative grid h-[170px] w-[170px] place-items-center">
        <svg viewBox="0 0 180 180" className="h-full w-full">
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="hsl(var(--primary) / 0.72)" />
              <stop offset="100%" stopColor="hsl(var(--primary))" />
            </linearGradient>
          </defs>

          <circle cx="90" cy="90" r="72" fill="transparent" stroke="hsl(var(--muted) / 0.75)" strokeWidth="12" />
          <motion.circle
            cx="90"
            cy="90"
            r="72"
            fill="transparent"
            stroke={`url(#${gradientId})`}
            strokeWidth="12"
            strokeLinecap="round"
            pathLength={1}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: progressTarget }}
            transition={{ duration: 0.95, ease: [0.22, 1, 0.36, 1] }}
            style={{ rotate: -90, transformOrigin: '50% 50%' }}
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <p className="text-[1.65rem] font-semibold leading-none text-foreground">
            {animatedUsed} / {safeLimit}
          </p>
          <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{animatedPercent}%</p>
        </div>
      </div>

      <div className="space-y-1 text-center">
        <p className="text-sm font-medium text-foreground">Aulas utilizadas</p>
        <p className="text-sm text-muted-foreground">
          {safeLimit === 0
            ? 'Você ainda não possui aulas disponíveis.'
            : remaining > 0
            ? `${remaining} aula${remaining === 1 ? '' : 's'} restantes`
            : 'Você utilizou todas as aulas disponíveis.'}
        </p>
      </div>
    </motion.div>
  );
};

export default MonthlyCreditsRadialProgress;
