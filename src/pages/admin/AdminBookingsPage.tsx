import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { cancelBooking, adminCheckIn } from '@/hooks/useSupabaseData';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useState } from 'react';
import { CheckCircle, XCircle, Clock, Users, User } from 'lucide-react';

const AdminBookingsPage = () => {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('booked');

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ['admin-all-bookings', statusFilter],
    queryFn: async () => {
      let query = supabase
        .from('bookings')
        .select('*, availability_slots(*), profiles!bookings_student_id_fkey(id, full_name)')
        .order('created_at', { ascending: false })
        .limit(100);

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data.map((b: any) => ({
        ...b,
        slot: b.availability_slots,
        student: b.profiles,
      }));
    },
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => cancelBooking(id),
    onSuccess: () => {
      toast.success('Cancelado');
      queryClient.invalidateQueries({ queryKey: ['admin-all-bookings'] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const checkInMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => adminCheckIn(id, status),
    onSuccess: () => {
      toast.success('Check-in realizado');
      queryClient.invalidateQueries({ queryKey: ['admin-all-bookings'] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const statusColors: Record<string, string> = {
    booked: 'default',
    completed: 'secondary',
    cancelled: 'destructive',
    no_show: 'outline',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-xl uppercase tracking-wider">Agendamentos</h1>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36 bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="booked">Agendados</SelectItem>
            <SelectItem value="completed">Concluídos</SelectItem>
            <SelectItem value="cancelled">Cancelados</SelectItem>
            <SelectItem value="no_show">Faltas</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : (
        <div className="space-y-2">
          {bookings.map((b: any) => (
            <div key={b.id} className="rounded-xl border border-border bg-card p-4 animate-fade-in">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    {b.seats_reserved === 2 ? <Users className="h-4 w-4 text-primary" /> : <User className="h-4 w-4 text-primary" />}
                    <span className="text-sm font-medium">{b.student?.full_name || 'Aluno'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {b.slot &&
                      new Date(b.slot.start_time).toLocaleDateString('pt-BR', {
                        weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo',
                      })}{' '}
                    {b.slot &&
                      new Date(b.slot.start_time).toLocaleTimeString('pt-BR', {
                        hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
                      })}
                  </div>
                  <div className="flex gap-2">
                    <Badge variant={statusColors[b.status] as any}>{b.status}</Badge>
                    <Badge variant="secondary">{b.seats_reserved === 2 ? 'Dupla' : 'Individual'}</Badge>
                    {b.created_by_admin && <Badge variant="outline">Lote</Badge>}
                  </div>
                </div>

                {b.status === 'booked' && (
                  <div className="flex flex-col gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-green-500 hover:text-green-400 h-7 text-xs"
                      onClick={() => checkInMut.mutate({ id: b.id, status: 'present' })}
                    >
                      <CheckCircle className="mr-1 h-3 w-3" /> Presente
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive h-7 text-xs"
                      onClick={() => checkInMut.mutate({ id: b.id, status: 'absent' })}
                    >
                      <XCircle className="mr-1 h-3 w-3" /> Falta
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground h-7 text-xs"
                      onClick={() => cancelMut.mutate(b.id)}
                    >
                      Cancelar
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {bookings.length === 0 && (
            <div className="rounded-xl border border-border bg-card p-8 text-center">
              <p className="text-muted-foreground">Nenhum agendamento encontrado</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AdminBookingsPage;
