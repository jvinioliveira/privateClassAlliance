import { motion } from 'framer-motion';
import { ArrowRight, CalendarPlus2 } from 'lucide-react';
import AnimatedCard from './AnimatedCard';

interface ScheduleClassCTAProps {
  onSchedule: () => void;
}

const ScheduleClassCTA = ({ onSchedule }: ScheduleClassCTAProps) => {
  return (
    <AnimatedCard className="border-primary/30 bg-gradient-to-r from-primary/20 via-primary/10 to-card p-5 sm:p-6">
      <button type="button" onClick={onSchedule} className="flex w-full items-center justify-between gap-3 text-left">
        <div className="min-w-0">
          <p className="text-lg font-semibold text-foreground sm:text-xl">Agendar aula</p>
          <p className="mt-1 text-sm text-muted-foreground">Veja os horários disponíveis no calendário.</p>
        </div>

        <motion.span
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/20 text-primary"
          animate={{ x: [0, 4, 0] }}
          transition={{ duration: 2, repeat: Infinity, repeatDelay: 1.1 }}
        >
          <CalendarPlus2 className="h-5 w-5" />
        </motion.span>
      </button>

      <motion.div
        whileHover={{ x: 2 }}
        className="mt-4 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-primary"
      >
        Abrir agenda agora
        <ArrowRight className="h-3.5 w-3.5" />
      </motion.div>
    </AnimatedCard>
  );
};

export default ScheduleClassCTA;
