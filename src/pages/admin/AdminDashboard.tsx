import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import luxonPlugin from '@fullcalendar/luxon3';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Clock, Users, User } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

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
    return { slotMinTime: '06:00:00', slotMaxTime: '22:00:00' };
  }

  let minStart = 24 * 60;
  let maxEnd = 0;

  for (const slot of slotList) {
    const start = getSlotTimeParts(slot.start_time);
    const end = getSlotTimeParts(slot.end_time);
    minStart = Math.min(minStart, start.hour * 60 + start.minute);
    maxEnd = Math.max(maxEnd, end.hour * 60 + end.minute);
  }

  const paddedMin = Math.max(0, minStart - 30);
  const paddedMax = Math.min(24 * 60, maxEnd + 30);

  return {
    slotMinTime: toCalendarTime(paddedMin),
    slotMaxTime: toCalendarTime(Math.max(paddedMax, paddedMin + 60)),
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

const AdminDashboard = () => {
  const isMobile = useIsMobile();
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
      const summaryLabel = isBlocked
        ? 'Bloqueado'
        : `${usedSeats}/${slot.capacity} - ${slotBookings.length} aluno(s)`;

      return {
        id: slot.id,
        title: summaryLabel,
        start: slot.start_time,
        end: slot.end_time,
        backgroundColor: isBlocked
          ? 'hsl(0 0% 25%)'
          : usedSeats >= slot.capacity
          ? 'hsl(0 65% 42%)'
          : 'hsl(43 72% 52%)',
        textColor: isBlocked ? 'hsl(0 0% 60%)' : usedSeats >= slot.capacity ? 'hsl(0 0% 95%)' : 'hsl(0 0% 5%)',
        borderColor: 'transparent',
        extendedProps: {
          slot,
          slotBookings,
          usedSeats,
          timeLabel: formatTimeWithH(slot.start_time),
          summaryLabel,
        },
      };
    });
  }, [slots, bookings]);

  const renderEventContent = (eventInfo: any) => {
    const { timeLabel, summaryLabel } = eventInfo.event.extendedProps as {
      timeLabel: string;
      summaryLabel: string;
    };

    return (
      <div className="w-full overflow-hidden whitespace-nowrap text-[11px] sm:text-xs">
        <span className="font-semibold">{timeLabel}</span>
        <span className="hidden truncate sm:inline"> - {summaryLabel}</span>
      </div>
    );
  };

  const calendarWindow = useMemo(() => getCalendarWindow(slots), [slots]);

  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl uppercase tracking-wider">Agenda Geral</h1>

      <div className="rounded-xl border border-border bg-card p-2 sm:p-4">
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, luxonPlugin]}
          initialView={isMobile ? 'timeGridDay' : 'timeGridWeek'}
          headerToolbar={{
            left: isMobile ? 'prev title next' : 'prev,next today',
            center: isMobile ? '' : 'title',
            right: isMobile ? '' : 'dayGridMonth,timeGridWeek,timeGridDay',
          }}
          locale="pt-br"
          timeZone="America/Sao_Paulo"
          allDaySlot={false}
          dayHeaderContent={renderTimeGridHeader}
          slotMinTime={calendarWindow.slotMinTime}
          slotMaxTime={calendarWindow.slotMaxTime}
          events={events}
          eventContent={renderEventContent}
          eventClick={(info) => {
            const { slot, slotBookings, usedSeats } = info.event.extendedProps;
            setSelectedSlot({ ...slot, slotBookings, usedSeats });
          }}
          datesSet={(info) => setDateRange({ start: info.startStr, end: info.endStr })}
          height="auto"
          eventDisplay="block"
          buttonText={{
            today: 'Hoje',
            month: 'Mês',
            week: 'Semana',
            day: 'Dia',
          }}
        />
      </div>

      <Dialog open={!!selectedSlot} onOpenChange={() => setSelectedSlot(null)}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto bg-card border-border sm:max-w-md">
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
                  {formatTimeWithH(selectedSlot.start_time)}
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
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
