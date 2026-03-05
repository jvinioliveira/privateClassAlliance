import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Clock, Users, User } from 'lucide-react';

const AdminDashboard = () => {
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [selectedSlot, setSelectedSlot] = useState<any>(null);

  const { data: slots = [] } = useQuery({
    queryKey: ['admin-slots', dateRange.start, dateRange.end],
    queryFn: async () => {
      if (!dateRange.start) return [];
      const { data, error } = await supabase
        .from('availability_slots')
        .select('*')
        .gte('start_time', dateRange.start)
        .lte('start_time', dateRange.end)
        .order('start_time');
      if (error) throw error;
      return data;
    },
    enabled: !!dateRange.start,
  });

  const slotIds = slots.map((s) => s.id);
  const { data: bookings = [] } = useQuery({
    queryKey: ['admin-bookings', slotIds],
    queryFn: async () => {
      if (!slotIds.length) return [];
      const { data, error } = await supabase
        .from('bookings')
        .select('*, profiles!bookings_student_id_fkey(id, full_name)')
        .in('slot_id', slotIds)
        .eq('status', 'booked');
      if (error) throw error;
      return data.map((b: any) => ({ ...b, student: b.profiles }));
    },
    enabled: slotIds.length > 0,
  });

  const events = useMemo(() => {
    return slots.map((slot) => {
      const slotBookings = bookings.filter((b: any) => b.slot_id === slot.id);
      const usedSeats = slotBookings.reduce((sum: number, b: any) => sum + b.seats_reserved, 0);
      const isBlocked = slot.status === 'blocked';

      return {
        id: slot.id,
        title: isBlocked
          ? '🔒 Bloqueado'
          : `${usedSeats}/${slot.capacity} - ${slotBookings.length} aluno(s)`,
        start: slot.start_time,
        end: slot.end_time,
        backgroundColor: isBlocked
          ? 'hsl(0 0% 25%)'
          : usedSeats >= slot.capacity
          ? 'hsl(0 65% 42%)'
          : 'hsl(43 72% 52%)',
        textColor: isBlocked ? 'hsl(0 0% 60%)' : usedSeats >= slot.capacity ? 'hsl(0 0% 95%)' : 'hsl(0 0% 5%)',
        borderColor: 'transparent',
        extendedProps: { slot, slotBookings, usedSeats },
      };
    });
  }, [slots, bookings]);

  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl uppercase tracking-wider">Agenda Geral</h1>

      <div className="rounded-xl border border-border bg-card p-2 sm:p-4">
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay',
          }}
          locale="pt-br"
          timeZone="America/Sao_Paulo"
          events={events}
          eventClick={(info) => {
            const { slot, slotBookings, usedSeats } = info.event.extendedProps;
            setSelectedSlot({ ...slot, slotBookings, usedSeats });
          }}
          datesSet={(info) => setDateRange({ start: info.startStr, end: info.endStr })}
          height="auto"
          eventDisplay="block"
          slotMinTime="06:00:00"
          slotMaxTime="22:00:00"
          buttonText={{
            today: 'Hoje',
            month: 'Mês',
            week: 'Semana',
            day: 'Dia',
          }}
        />
      </div>

      <Dialog open={!!selectedSlot} onOpenChange={() => setSelectedSlot(null)}>
        <DialogContent className="sm:max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-display text-lg uppercase tracking-wider">
              Detalhes do horário
            </DialogTitle>
          </DialogHeader>
          {selectedSlot && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="h-4 w-4" />
                <span className="text-sm">
                  {new Date(selectedSlot.start_time).toLocaleDateString('pt-BR', {
                    weekday: 'long',
                    day: '2-digit',
                    month: '2-digit',
                    timeZone: 'America/Sao_Paulo',
                  })}{' '}
                  às{' '}
                  {new Date(selectedSlot.start_time).toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: 'America/Sao_Paulo',
                  })}
                </span>
              </div>

              <div className="flex gap-2">
                <Badge variant={selectedSlot.status === 'blocked' ? 'outline' : 'default'}>
                  {selectedSlot.status === 'blocked' ? 'Bloqueado' : 'Disponível'}
                </Badge>
                <Badge variant="secondary">
                  {selectedSlot.usedSeats}/{selectedSlot.capacity} vagas
                </Badge>
              </div>

              {selectedSlot.slotBookings?.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">Alunos agendados:</p>
                  {selectedSlot.slotBookings.map((b: any) => (
                    <div key={b.id} className="flex items-center justify-between rounded-lg bg-muted p-3">
                      <div className="flex items-center gap-2">
                        {b.seats_reserved === 2 ? (
                          <Users className="h-4 w-4 text-primary" />
                        ) : (
                          <User className="h-4 w-4 text-primary" />
                        )}
                        <span className="text-sm">{b.student?.full_name || 'Aluno'}</span>
                      </div>
                      <Badge variant="secondary" className="text-xs">
                        {b.seats_reserved === 2 ? 'Dupla' : 'Individual'}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Nenhum aluno agendado</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminDashboard;
