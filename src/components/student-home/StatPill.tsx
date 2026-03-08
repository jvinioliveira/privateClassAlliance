import { animate, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

type StatPillTone = 'primary' | 'neutral' | 'success';

const toneMap: Record<StatPillTone, string> = {
  primary: 'border-primary/30 bg-primary/10 text-primary',
  neutral: 'border-border/80 bg-background/45 text-foreground',
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
};

interface StatPillProps {
  label: string;
  value: number;
  suffix?: string;
  tone?: StatPillTone;
}

const StatPill = ({ label, value, suffix = '', tone = 'neutral' }: StatPillProps) => {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    const controls = animate(0, Math.max(value, 0), {
      duration: 0.9,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => setDisplayValue(Math.round(latest)),
    });

    return () => controls.stop();
  }, [value]);

  return (
    <motion.div
      className={cn('rounded-xl border p-3', toneMap[tone])}
      whileHover={{ scale: 1.015 }}
      whileTap={{ scale: 0.99 }}
    >
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold">
        {displayValue}
        {suffix}
      </p>
    </motion.div>
  );
};

export default StatPill;
