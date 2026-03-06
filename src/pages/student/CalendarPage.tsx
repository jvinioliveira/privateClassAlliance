import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import luxonPlugin from '@fullcalendar/luxon3';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { bookSlot, joinWaitlist } from '@/hooks/useSupabaseData';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Users, User, Clock, AlertTriangle } from 'lucide-react';

const getMonthBounds = (monthRef: string) => {
  const [year, month] = monthRef.split('-').map(Number);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;

  return {
    start: `${year}-${String(month).padStart(2, '0')}-01T00:00:00-03:00`,
    end: `${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00-03:00`,
  };
};

type SlotTime = { start_time: string; end_time: string };

const getSlotTimeParts = (isoDate: string) => {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(isoDate));

  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');

  return { hour, minute };
};

const formatTimeWithH = (isoDate: string) => {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(isoDate));

  const hourRaw = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minuteRaw = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${hourRaw}h${minuteRaw}`;
};

const toCalendarTime = (totalMinutes: number) => {
  const clamped = Math.max(0, Math.min(24 * 60, totalMinutes));
  const hours = Math.floor(clamped / 60);
  const minutes = clamped % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
};

const getCalendarWindow = (slotList: SlotTime[]) => {
  if (!slotList.length) {
    return { slotMinTime: '08:00:00', slotMaxTime: '09:00:00' };
  }

  let minStart = 24 * 60;
  let maxEnd = 0;

  for (const slot of slotList) {
    const start = getSlotTimeParts(slot.start_time);
    const end = getSlotTimeParts(slot.end_time);
    minStart = Math.min(minStart, start.hour * 60 + start.minute);
    maxEnd = Math.max(maxEnd, end.hour * 60 + end.minute);
  }

  const paddedMin = Math.max(0, minStart - 15);
  const paddedMax = Math.min(24 * 60, maxEnd + 15);

  return {
    slotMinTime: toCalendarTime(paddedMin),
    slotMaxTime: toCalendarTime(Math.max(paddedMax, paddedMin + 30)),
  };
};

const renderTimeGridHeader = (arg: { date: Date; text: string; view: { type: string } }) => {
  if (!arg.view.type.startsWith('timeGrid')) return arg.text.replace(/\./g, '');

  const dateLabel = arg.date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });

  const weekdayLongLabel = arg.date
    .toLocaleDateString('pt-BR', {
      weekday: 'long',
      timeZone: 'America/Sao_Paulo',
    })
    .replace('-feira', '');

  const weekdayShortLabel = arg.date
    .toLocaleDateString('pt-BR', {
      weekday: 'short',
      timeZone: 'America/Sao_Paulo',
    })
    .replace(/\./g, '');

  return (
    <div className="flex flex-col items-center leading-tight">
      <span>{dateLabel}</span>
      <span className="text-[11px] text-muted-foreground">
        <span className="capitalize sm:hidden">{weekdayShortLabel}</span>
        <span className="hidden capitalize sm:inline">{weekdayLongLabel}</span>
      </span>
    </div>
  );
};

const CalendarPage = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [selectedSlot, setSelectedSlot] = useState<any>(null);
  const [bookingType, setBookingType] = useState<1 | 2>(1);

  // Current month ref for credits
  const now = new Date();
  const monthRef = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  // Credits
  const { data: credits } = useQuery({
    queryKey: ['my-credits', user?.id, monthRef],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from('student_month_credits')
        .select('*')
        .eq('student_id', user.id)
        .eq('month_ref', monthRef)
        .maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  const { data: usedCredits } = useQuery({
    queryKey: ['used-credits', user?.id, monthRef],
    queryFn: async () => {
      if (!user) return 0;

      const { start, end } = getMonthBounds(monthRef);
      const { count, error } = await supabase
        .from('bookings')
        .select('id, availability_slots!inner(start_time)', { count: 'exact', head: true })
        .eq('student_id', user.id)
        .eq('status', 'booked')
        .gte('availability_slots.start_time', start)
        .lt('availability_slots.start_time', end);

      if (error) throw error;

      return count || 0;
    },
    enabled: !!user && !!monthRef,
  });

  // Slots
  const { data: slots = [] } = useQuery({
    queryKey: ['slots', dateRange.start, dateRange.end],
    queryFn: async () => {
      if (!dateRange.start) return [];
      const { data, error } = await supabase
        .from('availability_slots')
        .select('*')
        .gte('start_time', dateRange.start)
        .lt('start_time', dateRange.end)
        .eq('status', 'available')
        .order('start_time');
      if (error) throw error;
      return data;
    },
    enabled: !!dateRange.start,
  });

  const calendarWindow = useMemo(() => getCalendarWindow(slots), [slots]);

  // Bookings for these slots
  const slotIds = slots.map((s) => s.id);
  const { data: bookings = [] } = useQuery({
    queryKey: ['bookings-for-slots', slotIds],
    queryFn: async () => {
      if (!slotIds.length) return [];
      const { data, error } = await supabase
        .from('bookings')
        .select('*')
        .in('slot_id', slotIds)
        .eq('status', 'booked');
      if (error) throw error;
      return data;
    },
    enabled: slotIds.length > 0,
  });

  // Build calendar events
  const events = useMemo(() => {
    return slots.map((slot) => {
      const slotBookings = bookings.filter((b) => b.slot_id === slot.id);
      const usedSeats = slotBookings.reduce((sum, b) => sum + b.seats_reserved, 0);
      const freeSeats = slot.capacity - usedSeats;
      const isMine = slotBookings.some((b) => b.student_id === user?.id);
      const isFull = freeSeats <= 0;
      const statusLabel = isMine
        ? 'Agendado'
        : isFull
        ? 'Lotado'
        : `${freeSeats}/${slot.capacity} vagas`;

      return {
        id: slot.id,
        title: statusLabel,
        start: slot.start_time,
        end: slot.end_time,
        backgroundColor: isMine
          ? 'hsl(120 40% 30%)'
          : isFull
          ? 'hsl(0 65% 42%)'
          : 'hsl(43 72% 52%)',
        textColor: isMine ? 'hsl(120 40% 90%)' : isFull ? 'hsl(0 0% 95%)' : 'hsl(0 0% 5%)',
        borderColor: 'transparent',
        extendedProps: {
          slot,
          freeSeats,
          isMine,
          isFull,
          usedSeats,
          timeLabel: formatTimeWithH(slot.start_time),
          statusLabel,
        },
      };
    });
  }, [slots, bookings, user]);

  const renderEventContent = (eventInfo: any) => {
    const { timeLabel, statusLabel } = eventInfo.event.extendedProps as {
      timeLabel: string;
      statusLabel: string;
    };

    return (
      <div className="w-full overflow-hidden whitespace-nowrap text-[11px] sm:text-xs">
        <span className="font-semibold">{timeLabel}</span>
        <span className="hidden truncate sm:inline"> - {statusLabel}</span>
      </div>
    );
  };

  const bookMutation = useMutation({
    mutationFn: ({ slotId, seats }: { slotId: string; seats: number }) =>
      bookSlot(slotId, seats),
    onSuccess: () => {
      toast.success('Aula agendada com sucesso!');
      setSelectedSlot(null);
      queryClient.invalidateQueries({ queryKey: ['slots'] });
      queryClient.invalidateQueries({ queryKey: ['bookings-for-slots'] });
      queryClient.invalidateQueries({ queryKey: ['used-credits'] });
      queryClient.invalidateQueries({ queryKey: ['my-bookings'] });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Erro ao agendar');
    },
  });

  const waitlistMutation = useMutation({
    mutationFn: (slotId: string) => joinWaitlist(slotId),
    onSuccess: () => {
      toast.success('Adicionado à lista de espera!');
      setSelectedSlot(null);
    },
    onError: (err: any) => {
      toast.error(err.message || 'Erro ao entrar na lista');
    },
  });

  const handleEventClick = (info: any) => {
    const { slot, freeSeats, isMine, isFull } = info.event.extendedProps;
    setSelectedSlot({ ...slot, freeSeats, isMine, isFull });
    setBookingType(1);
  };

  const handleDatesSet = (dateInfo: any) => {
    setDateRange({
      start: dateInfo.start.toISOString(),
      end: dateInfo.end.toISOString(),
    });
  };

  const handleDateClick = (info: any) => {
    if (info.view.type === 'dayGridMonth') {
      const dayStart = new Date(info.date);
      const dayEnd = new Date(info.date);
      dayEnd.setDate(dayEnd.getDate() + 1);
      setDateRange({
        start: dayStart.toISOString(),
        end: dayEnd.toISOString(),
      });
      info.view.calendar.changeView('timeGridDay', info.dateStr);
    }
  };

  const remaining = (credits?.monthly_limit || 0) - (usedCredits || 0);

  return (
    <div className="space-y-4 p-4">
      {/* Credits card */}
      <div className="rounded-xl border border-border bg-card p-4 animate-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-display">
              Aulas este mês
            </p>
            <p className="mt-1 text-2xl font-bold text-foreground font-display">
              <span className="text-primary">{usedCredits || 0}</span>
              <span className="text-muted-foreground">/{credits?.monthly_limit || 0}</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Restantes</p>
            <p className={`text-xl font-bold font-display ${remaining <= 0 ? 'text-destructive' : 'text-primary'}`}>
              {remaining < 0 ? 0 : remaining}
            </p>
          </div>
        </div>
      </div>

      {/* Calendar */}
      <div className="rounded-xl border border-border bg-card p-2 sm:p-4 animate-fade-in">
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, luxonPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,timeGridDay',
          }}
          locale="pt-br"
          timeZone="America/Sao_Paulo"
          allDaySlot={false}
          dayHeaderContent={renderTimeGridHeader}
          dateClick={handleDateClick}
          slotMinTime={calendarWindow.slotMinTime}
          slotMaxTime={calendarWindow.slotMaxTime}
          events={events}
          eventContent={renderEventContent}
          eventClick={handleEventClick}
          datesSet={handleDatesSet}
          height="auto"
          eventDisplay="block"
          dayMaxEvents={3}
          buttonText={{
            today: 'Hoje',
            month: 'Mês',
            week: 'Semana',
            day: 'Dia',
          }}
        />
      </div>

      {/* Booking Modal */}
      <Dialog open={!!selectedSlot} onOpenChange={() => setSelectedSlot(null)}>
        <DialogContent className="sm:max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-display text-lg uppercase tracking-wider">
              {selectedSlot?.isMine ? 'Aula agendada' : selectedSlot?.isFull ? 'Horário lotado' : 'Agendar aula'}
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
                  {formatTimeWithH(selectedSlot.start_time)}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Badge variant={selectedSlot.isFull ? 'destructive' : 'default'}>
                  {selectedSlot.freeSeats}/{selectedSlot.capacity} vagas
                </Badge>
              </div>

              {selectedSlot.isMine ? (
                <p className="text-sm text-muted-foreground">
                  Você já está agendado para este horário.
                </p>
              ) : selectedSlot.isFull ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                    <span>Este horário está lotado</span>
                  </div>
                  <Button
                    onClick={() => waitlistMutation.mutate(selectedSlot.id)}
                    disabled={waitlistMutation.isPending}
                    variant="outline"
                    className="w-full font-display uppercase tracking-wider"
                  >
                    {waitlistMutation.isPending ? 'Entrando...' : 'Entrar na lista de espera'}
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Type selection */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-foreground">Tipo da aula:</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setBookingType(1)}
                        className={`flex items-center justify-center gap-2 rounded-lg border p-3 text-sm transition-colors ${
                          bookingType === 1
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border text-muted-foreground hover:border-primary/50'
                        }`}
                      >
                        <User className="h-4 w-4" />
                        Individual
                      </button>
                      <button
                        onClick={() => setBookingType(2)}
                        disabled={selectedSlot.freeSeats < 2}
                        className={`flex items-center justify-center gap-2 rounded-lg border p-3 text-sm transition-colors ${
                          bookingType === 2
                            ? 'border-primary bg-primary/10 text-primary'
                            : selectedSlot.freeSeats < 2
                            ? 'border-border text-muted-foreground/40 cursor-not-allowed'
                            : 'border-border text-muted-foreground hover:border-primary/50'
                        }`}
                      >
                        <Users className="h-4 w-4" />
                        Dupla
                      </button>
                    </div>
                    {bookingType === 2 && (
                      <p className="text-xs text-muted-foreground">
                        Dupla ocupa 2 vagas, mas conta como 1 crédito.
                      </p>
                    )}
                  </div>

                  <Button
                    onClick={() =>
                      bookMutation.mutate({ slotId: selectedSlot.id, seats: bookingType })
                    }
                    disabled={bookMutation.isPending}
                    className="w-full font-display uppercase tracking-wider"
                  >
                    {bookMutation.isPending ? 'Agendando...' : 'Confirmar agendamento'}
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CalendarPage;
