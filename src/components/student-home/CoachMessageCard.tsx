import { MessageSquareDot } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import AnimatedCard from './AnimatedCard';
import type { CoachMessageSummary } from './types';

interface CoachMessageCardProps {
  loading: boolean;
  hasError: boolean;
  message: CoachMessageSummary | null;
  onOpenInbox?: () => void;
}

const fallbackMessage = 'Nao foi possivel carregar a mensagem do professor.';

const CoachMessageCard = ({ loading, hasError, message, onOpenInbox }: CoachMessageCardProps) => {
  const visibleMessage = message?.content?.trim() || '';
  const title = message?.title?.trim() || 'Mensagem do professor';

  return (
    <AnimatedCard className="p-5 sm:p-6" hoverable={false}>
      <div className="space-y-3.5">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-primary/25 bg-primary/12">
            <MessageSquareDot className="h-4.5 w-4.5 text-primary" />
          </span>
          <h2 className="text-lg text-foreground sm:text-xl">Mensagem do professor</h2>
        </div>

        {loading ? (
          <div className="space-y-2.5">
            <Skeleton className="h-4 w-40 rounded-md bg-muted/70" />
            <Skeleton className="h-3.5 w-full rounded-md bg-muted/70" />
            <Skeleton className="h-3.5 w-[88%] rounded-md bg-muted/70" />
          </div>
        ) : hasError ? (
          <div className="rounded-xl border border-border/80 bg-background/35 p-4 text-sm text-muted-foreground">
            {fallbackMessage}
          </div>
        ) : !message ? (
          <div className="rounded-xl border border-border/80 bg-background/35 p-4 text-sm text-muted-foreground">
            Não há novas mensagens do professor.
          </div>
        ) : (
          <div className="rounded-xl border border-border/80 bg-background/35 p-4">
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{visibleMessage}</p>
            {message.createdAtLabel && (
              <p className="mt-2 text-[11px] uppercase tracking-wide text-muted-foreground/80">
                Atualizado em {message.createdAtLabel}
              </p>
            )}
            {onOpenInbox && (
              <Button
                type="button"
                size="sm"
                className="mt-3 h-9 w-full bg-primary text-xs font-semibold text-primary-foreground hover:bg-primary/90 sm:w-auto"
                onClick={onOpenInbox}
              >
                Abrir chat com o professor
              </Button>
            )}
          </div>
        )}
      </div>
    </AnimatedCard>
  );
};

export default CoachMessageCard;
