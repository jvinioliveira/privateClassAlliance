import { motion } from 'framer-motion';
import { AlertCircle, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import AnimatedCard from './AnimatedCard';

interface SmartReminderBannerProps {
  loading: boolean;
  hasError: boolean;
  remainingCredits: number;
  monthlyLimit: number;
  onPrimaryAction: () => void;
}

const SmartReminderBanner = ({
  loading,
  hasError,
  remainingCredits,
  monthlyLimit,
  onPrimaryAction,
}: SmartReminderBannerProps) => {
  const hasCredits = remainingCredits > 0;

  return (
    <AnimatedCard
      className={
        hasCredits
          ? 'border-primary/25 bg-gradient-to-r from-primary/12 via-card to-card p-5'
          : 'border-border/80 bg-gradient-to-r from-card via-card to-muted/45 p-5'
      }
    >
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <div
            className={
              hasCredits
                ? 'rounded-lg border border-primary/30 bg-primary/15 p-2 text-primary'
                : 'rounded-lg border border-border/80 bg-background/35 p-2 text-muted-foreground'
            }
          >
            {hasCredits ? <Sparkles className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">Lembrete inteligente</p>
            {loading && (
              <>
                <Skeleton className="h-3 w-52 rounded-md bg-muted/70" />
                <Skeleton className="h-3 w-44 rounded-md bg-muted/70" />
              </>
            )}

            {!loading && hasError && (
              <p className="text-xs text-muted-foreground">Não foi possível montar o lembrete agora.</p>
            )}

            {!loading && !hasError && (
              <>
                {hasCredits ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Você ainda tem {remainingCredits} aula{remainingCredits > 1 ? 's' : ''} disponível
                      {remainingCredits > 1 ? 'is' : ''} este mês.
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Aproveite para agendar antes do fim do mês.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      {monthlyLimit > 0
                        ? 'Suas aulas deste mês já foram utilizadas.'
                        : 'Você ainda não possui créditos ativos neste mês.'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Consulte novos horários ou fale com o professor para renovar.
                    </p>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {!loading && !hasError && (
          <motion.div whileTap={{ scale: 0.98 }}>
            <Button
              variant={hasCredits ? 'default' : 'outline'}
              className="h-10 w-full rounded-xl text-sm font-semibold"
              onClick={onPrimaryAction}
            >
              {hasCredits ? 'Ver horários disponíveis' : 'Ver planos disponíveis'}
            </Button>
          </motion.div>
        )}
      </div>
    </AnimatedCard>
  );
};

export default SmartReminderBanner;
