import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CalendarCheck2, CalendarPlus2, CalendarX2, Clock3, MoveRight, Repeat2 } from 'lucide-react';
import { motion } from 'framer-motion';
import AnimatedCard from './AnimatedCard';
import EmptyStateBlock from './EmptyStateBlock';
import type { NextClassSummary } from './types';

interface NextClassCardProps {
  loading: boolean;
  hasError: boolean;
  nextClass: NextClassSummary | null;
  isCancelling: boolean;
  onSchedule: () => void;
  onSeeCalendar: () => void;
  onReschedule: (bookingId: string) => void;
  onCancel: (bookingId: string) => void;
}

const NextClassCard = ({
  loading,
  hasError,
  nextClass,
  isCancelling,
  onSchedule,
  onSeeCalendar,
  onReschedule,
  onCancel,
}: NextClassCardProps) => {
  return (
    <AnimatedCard
      className="relative border-primary/20 bg-gradient-to-br from-card via-card to-primary/5 p-5 sm:p-6"
      whileHover={{ y: -3, scale: 1.008 }}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.22),transparent_44%)]" />
      <div className="relative space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary/90">Próxima aula</p>
            <h2 className="mt-1 text-2xl leading-tight text-foreground sm:text-[1.85rem]">Seu próximo treino</h2>
          </div>
          <CalendarCheck2 className="mt-1 h-5 w-5 text-primary/85" />
        </div>

        {loading && (
          <div className="space-y-3">
            <Skeleton className="h-5 w-40 rounded-md bg-muted/70" />
            <Skeleton className="h-5 w-32 rounded-md bg-muted/70" />
            <div className="grid grid-cols-2 gap-2 pt-1">
              <Skeleton className="h-9 rounded-lg bg-muted/70" />
              <Skeleton className="h-9 rounded-lg bg-muted/70" />
            </div>
          </div>
        )}

        {!loading && hasError && (
          <EmptyStateBlock
            icon={CalendarX2}
            title="Não foi possível carregar sua próxima aula."
            description="Tente novamente em instantes ou abra o calendário para conferir seus horários."
          />
        )}

        {!loading && !hasError && !nextClass && (
          <div className="space-y-4">
            <EmptyStateBlock
              icon={CalendarPlus2}
              title="Você ainda não tem aulas agendadas."
              description="Escolha um horário disponível e organize seu próximo treino."
            />
            <Button className="h-11 w-full rounded-xl text-sm font-semibold" onClick={onSchedule}>
              Agendar aula
            </Button>
          </div>
        )}

        {!loading && !hasError && nextClass && (
          <div className="space-y-4">
            <div className="grid gap-3 rounded-xl border border-border/80 bg-background/35 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="space-y-1.5">
                <p className="text-sm font-semibold text-foreground">{nextClass.dateLabel}</p>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock3 className="h-3.5 w-3.5" />
                  <span>{nextClass.timeLabel}</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2 sm:justify-end">
                <Badge className="border-primary/35 bg-primary/10 text-primary hover:bg-primary/15">
                  {nextClass.classTypeLabel}
                </Badge>
                <Badge variant="outline" className="border-border/80 bg-background/40 text-muted-foreground">
                  {nextClass.statusLabel}
                </Badge>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <motion.div whileTap={{ scale: 0.98 }}>
                <Button
                  variant="secondary"
                  className="h-10 w-full rounded-xl text-xs font-semibold sm:text-sm"
                  onClick={onSeeCalendar}
                >
                  Ver no calendário
                </Button>
              </motion.div>

              <motion.div whileTap={{ scale: 0.98 }}>
                <Button
                  variant="outline"
                  className="h-10 w-full rounded-xl text-xs font-semibold sm:text-sm"
                  onClick={() => onReschedule(nextClass.id)}
                >
                  <Repeat2 className="mr-1.5 h-3.5 w-3.5" />
                  Remarcar
                </Button>
              </motion.div>

              <motion.div whileTap={{ scale: 0.98 }}>
                <Button
                  variant="ghost"
                  disabled={!nextClass.canCancel || isCancelling}
                  className="h-10 w-full rounded-xl text-xs font-semibold text-destructive hover:text-destructive sm:text-sm"
                  onClick={() => onCancel(nextClass.id)}
                >
                  {isCancelling ? 'Cancelando...' : 'Cancelar'}
                </Button>
              </motion.div>
            </div>

            {!nextClass.canCancel && (
              <p className="text-xs text-muted-foreground">
                O cancelamento fica indisponível para aulas com menos de 24 horas.
              </p>
            )}

            <button
              type="button"
              onClick={onSchedule}
              className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-primary transition-opacity hover:opacity-80"
            >
              Ver horários disponíveis
              <MoveRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </AnimatedCard>
  );
};

export default NextClassCard;
