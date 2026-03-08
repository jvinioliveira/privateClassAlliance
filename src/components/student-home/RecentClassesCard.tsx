import { AnimatePresence, motion } from 'framer-motion';
import { Clock3, History } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import AnimatedCard from './AnimatedCard';
import EmptyStateBlock from './EmptyStateBlock';
import StatusBadge from './StatusBadge';
import type { RecentClassSummary } from './types';

const listContainerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.08,
    },
  },
};

const listItemVariants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.28 } },
};

interface RecentClassesCardProps {
  loading: boolean;
  hasError: boolean;
  classes: RecentClassSummary[];
}

const RecentClassesCard = ({ loading, hasError, classes }: RecentClassesCardProps) => {
  return (
    <AnimatedCard className="p-5 sm:p-6">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Últimas aulas</p>
            <h2 className="mt-1 text-lg text-foreground sm:text-xl">Histórico recente</h2>
          </div>
          <History className="h-4.5 w-4.5 text-primary/80" />
        </div>

        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2.5">
              {Array.from({ length: 4 }).map((_, idx) => (
                <Skeleton key={idx} className="h-[62px] rounded-xl bg-muted/70" />
              ))}
            </motion.div>
          ) : hasError ? (
            <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <EmptyStateBlock
                title="Não foi possível carregar seu histórico."
                description="Tente novamente em alguns instantes."
              />
            </motion.div>
          ) : classes.length === 0 ? (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <EmptyStateBlock
                title="Ainda não há aulas no histórico."
                description="Quando suas primeiras aulas forem concluídas, elas aparecerão aqui."
              />
            </motion.div>
          ) : (
            <motion.ul
              key="list"
              variants={listContainerVariants}
              initial="hidden"
              animate="show"
              exit={{ opacity: 0 }}
              className="space-y-2"
            >
              {classes.map((item) => (
                <motion.li
                  key={item.id}
                  variants={listItemVariants}
                  className="rounded-xl border border-border/80 bg-background/35 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <p className="truncate text-sm font-medium text-foreground">{item.dateLabel}</p>
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock3 className="h-3.5 w-3.5" />
                        {item.timeLabel}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <StatusBadge status={item.status} />
                      <span
                        className={cn(
                          'rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                          'border-border/80 bg-background/50 text-muted-foreground',
                        )}
                      >
                        {item.classTypeLabel}
                      </span>
                    </div>
                  </div>
                </motion.li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
    </AnimatedCard>
  );
};

export default RecentClassesCard;
