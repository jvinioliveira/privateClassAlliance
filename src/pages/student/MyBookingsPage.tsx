import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { cancelBooking } from '@/hooks/useSupabaseData';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Clock, X, CheckCircle, AlertCircle } from 'lucide-react';

const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  booked: { label: 'Agendada', variant: 'default' },
  completed: { label: 'Concluída', variant: 'secondary' },
  cancelled: { label: 'Cancelada', variant: 'destructive' },
  no_show: { label: 'Falta', variant: 'outline' },
};

const MyBookingsPage = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ['my-bookings', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('bookings')
        .select('*, availability_slots(*)')
        .eq('student_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data.map((b: any) => ({ ...b, slot: b.availability_slots }));
    },
    enabled: !!user,
  });

  const cancelMutation = useMutation({
    mutationFn: (bookingId: string) => cancelBooking(bookingId),
    onSuccess: () => {
      toast.success('Aula cancelada');
      queryClient.invalidateQueries({ queryKey: ['my-bookings'] });
      queryClient.invalidateQueries({ queryKey: ['used-credits'] });
    },
    onError: (err: any) => toast.error(err.message || 'Erro ao cancelar'),
  });

  const canCancel = (slotStartTime: string) => {
    const start = new Date(slotStartTime);
    const diff = start.getTime() - Date.now();
    return diff >= 24 * 60 * 60 * 1000;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <h1 className="font-display text-xl uppercase tracking-wider text-foreground">
        Meus Agendamentos
      </h1>

      {bookings.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-muted-foreground">Nenhum agendamento encontrado</p>
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map((booking: any) => {
            const status = statusMap[booking.status] || statusMap.booked;
            return (
              <div
                key={booking.id}
                className="rounded-xl border border-border bg-card p-4 animate-fade-in"
              >
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium text-foreground">
                        {booking.slot &&
                          new Date(booking.slot.start_time).toLocaleDateString('pt-BR', {
                            weekday: 'short',
                            day: '2-digit',
                            month: '2-digit',
                            timeZone: 'America/Sao_Paulo',
                          })}{' '}
                        às{' '}
                        {booking.slot &&
                          new Date(booking.slot.start_time).toLocaleTimeString('pt-BR', {
                            hour: '2-digit',
                            minute: '2-digit',
                            timeZone: 'America/Sao_Paulo',
                          })}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={status.variant}>{status.label}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {booking.seats_reserved === 2 ? 'Dupla' : 'Individual'}
                      </span>
                    </div>
                  </div>

                  {booking.status === 'booked' && booking.slot && canCancel(booking.slot.start_time) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => cancelMutation.mutate(booking.id)}
                      disabled={cancelMutation.isPending}
                      className="text-destructive hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>

                {booking.status === 'booked' && booking.slot && !canCancel(booking.slot.start_time) && (
                  <p className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    Cancelamento indisponível (menos de 24h)
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MyBookingsPage;
