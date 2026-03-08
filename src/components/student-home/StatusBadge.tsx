import { cn } from '@/lib/utils';
import type { StatusBadgeKind } from './types';

const statusStyleMap: Record<StatusBadgeKind, { label: string; className: string }> = {
  agendada: {
    label: 'Agendada',
    className: 'border-primary/45 bg-primary/10 text-primary',
  },
  concluida: {
    label: 'Concluída',
    className: 'border-emerald-500/45 bg-emerald-500/10 text-emerald-400',
  },
  presente: {
    label: 'Presente',
    className: 'border-emerald-500/45 bg-emerald-500/10 text-emerald-400',
  },
  faltou: {
    label: 'Faltou',
    className: 'border-orange-500/45 bg-orange-500/10 text-orange-300',
  },
  cancelada: {
    label: 'Cancelada',
    className: 'border-destructive/45 bg-destructive/10 text-destructive',
  },
};

interface StatusBadgeProps {
  status: StatusBadgeKind;
  className?: string;
}

const StatusBadge = ({ status, className }: StatusBadgeProps) => {
  const style = statusStyleMap[status];

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide',
        style.className,
        className,
      )}
    >
      {style.label}
    </span>
  );
};

export default StatusBadge;
