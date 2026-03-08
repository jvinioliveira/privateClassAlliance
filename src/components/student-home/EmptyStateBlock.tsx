import type { LucideIcon } from 'lucide-react';
import { CalendarX2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EmptyStateBlockProps {
  title: string;
  description: string;
  icon?: LucideIcon;
  className?: string;
}

const EmptyStateBlock = ({ title, description, icon: Icon = CalendarX2, className }: EmptyStateBlockProps) => {
  return (
    <div
      className={cn(
        'rounded-xl border border-dashed border-border/80 bg-background/35 p-5 text-center',
        className,
      )}
    >
      <Icon className="mx-auto mb-3 h-5 w-5 text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
    </div>
  );
};

export default EmptyStateBlock;
