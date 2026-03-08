import { animate, motion, type Variants } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { Activity, Flame, Trophy, TrendingUp } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import AnimatedCard from './AnimatedCard';
import StatPill from './StatPill';
import type { ProgressStats } from './types';

interface StudentProgressCardProps {
  loading: boolean;
  hasError: boolean;
  stats: ProgressStats;
}

const contentVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.35,
      staggerChildren: 0.08,
      delayChildren: 0.04,
      ease: [0.22, 1, 0.36, 1],
    },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] } },
};

const weekLabels = ['Sem -3', 'Sem -2', 'Sem -1', 'Atual'];

const StudentProgressCard = ({ loading, hasError, stats }: StudentProgressCardProps) => {
  const monthRatio = stats.monthlyLimit > 0 ? stats.completedThisMonth / stats.monthlyLimit : 0;
  const progressPercent = Math.max(0, Math.min(monthRatio * 100, 100));

  const trendSeries = useMemo(() => {
    const source = Array.isArray(stats.weeklySeries) && stats.weeklySeries.length === 4 ? stats.weeklySeries : [0, 0, 0, 0];
    return source.map((value, index) => ({
      label: weekLabels[index],
      value: Math.max(value, 0),
    }));
  }, [stats.weeklySeries]);

  const hasTrendData = trendSeries.some((item) => item.value > 0);

  const rhythmCopy = useMemo(() => {
    if (stats.totalCompleted === 0) return 'Seu progresso será mostrado conforme suas aulas forem concluídas.';
    if (monthRatio >= 0.75) return 'Bom ritmo neste mês.';
    if (monthRatio >= 0.35) return 'Você está mantendo constância.';
    return 'Reserve um horário para manter a evolução.';
  }, [monthRatio, stats.totalCompleted]);

  const [animatedTotalCompleted, setAnimatedTotalCompleted] = useState(0);
  const [animatedStreak, setAnimatedStreak] = useState(0);
  const [animatedRecentFrequency, setAnimatedRecentFrequency] = useState(0);

  useEffect(() => {
    if (loading || hasError) {
      setAnimatedTotalCompleted(0);
      setAnimatedStreak(0);
      setAnimatedRecentFrequency(0);
      return;
    }

    const totalControls = animate(0, Math.max(stats.totalCompleted, 0), {
      duration: 0.8,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (value) => setAnimatedTotalCompleted(Math.round(value)),
    });

    const streakControls = animate(0, Math.max(stats.streakWeeks, 0), {
      duration: 0.8,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (value) => setAnimatedStreak(Math.round(value)),
    });

    const recentControls = animate(0, Math.max(stats.recentFrequency, 0), {
      duration: 0.8,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (value) => setAnimatedRecentFrequency(Math.round(value)),
    });

    return () => {
      totalControls.stop();
      streakControls.stop();
      recentControls.stop();
    };
  }, [hasError, loading, stats.recentFrequency, stats.streakWeeks, stats.totalCompleted]);

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
          <motion.div initial="hidden" animate="show" variants={contentVariants} className="space-y-3.5">
            <motion.div variants={itemVariants} className="grid grid-cols-2 gap-2.5">
              <StatPill label="Total concluídas" value={stats.totalCompleted} tone="primary" />
              <StatPill label="Concluídas no mês" value={stats.completedThisMonth} tone="success" />
            </motion.div>

            <motion.div variants={itemVariants} className="rounded-xl border border-primary/25 bg-gradient-to-b from-primary/10 via-background/55 to-background/35 p-3.5">
              <div className="mb-1 flex items-center gap-1.5 text-sm font-medium text-foreground">
                <TrendingUp className="h-4 w-4 text-primary" />
                Últimas 4 semanas
              </div>
              <p className="mb-2 text-xs text-muted-foreground">Informativo de sequência e frequência recente</p>

              <div className="h-44 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendSeries} margin={{ top: 10, right: 4, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="studentTrendFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.55)" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                    <YAxis allowDecimals={false} width={26} tickLine={false} axisLine={false} domain={[0, (dataMax: number) => Math.max(dataMax + 1, 1)]} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} />
                    <Tooltip
                      cursor={{ stroke: 'hsl(var(--primary) / 0.4)', strokeWidth: 1 }}
                      contentStyle={{
                        borderRadius: 10,
                        border: '1px solid hsl(var(--border))',
                        backgroundColor: 'hsl(var(--card))',
                        color: 'hsl(var(--foreground))',
                      }}
                      labelStyle={{ color: 'hsl(var(--muted-foreground))' }}
                      formatter={(value) => [`${value} aulas`, 'Concluídas']}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="hsl(var(--primary) / 0.45)"
                      fill="url(#studentTrendFill)"
                      strokeWidth={2}
                      isAnimationActive
                      animationDuration={900}
                      animationEasing="ease-out"
                    />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2.4}
                      dot={{ r: 2.8, strokeWidth: 1, stroke: 'hsl(var(--card))', fill: 'hsl(var(--primary))' }}
                      activeDot={{ r: 4 }}
                      isAnimationActive
                      animationDuration={1000}
                      animationEasing="ease-out"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {!hasTrendData && (
                <p className="mt-1 text-xs text-muted-foreground">Sem aulas concluídas nas últimas 4 semanas.</p>
              )}

              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg border border-border/70 bg-background/45 p-2 text-muted-foreground">
                  <p className="flex items-center gap-1">
                    <Flame className="h-3.5 w-3.5 text-primary/80" />
                    Sequência atual
                  </p>
                  <p className="mt-1 font-medium text-foreground">{animatedStreak} semana{animatedStreak === 1 ? '' : 's'}</p>
                </div>
                <div className="rounded-lg border border-border/70 bg-background/45 p-2 text-muted-foreground">
                  <p>Frequência recente</p>
                  <p className="mt-1 font-medium text-foreground">{animatedRecentFrequency} aula{animatedRecentFrequency === 1 ? '' : 's'}</p>
                </div>
              </div>
            </motion.div>

            <motion.div variants={itemVariants} className="space-y-2 rounded-xl border border-border/75 bg-background/35 p-3">
              <div className="space-y-1.5">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Meta do mês</p>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-primary/80 to-primary"
                    initial={{ width: 0 }}
                    animate={{ width: `${progressPercent}%` }}
                    transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                  />
                </div>
              </div>

              <p className="text-sm text-foreground">
                Você já concluiu <span className="font-semibold text-primary">{animatedTotalCompleted}</span> aula
                {animatedTotalCompleted === 1 ? '' : 's'}.
              </p>
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Activity className="h-3.5 w-3.5 text-primary/80" />
                {rhythmCopy}
              </p>
            </motion.div>
          </motion.div>
        )}
      </div>
    </AnimatedCard>
  );
};

export default StudentProgressCard;
