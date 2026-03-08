import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import luxonPlugin from '@fullcalendar/luxon3';
import type { DateClickArg } from '@fullcalendar/interaction';
import type { DatesSetArg, EventClickArg, EventContentArg } from '@fullcalendar/core';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { useAuth } from '@/contexts/AuthContext';
import { bookSlot, joinWaitlist } from '@/hooks/useSupabaseData';
import { fetchStudentCreditSummary, type StudentCreditSummary } from '@/lib/student-credits';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Users, User, Clock, AlertTriangle, Plus } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

type SlotTime = { start_time: string; end_time: string };
type SlotRow = Database['public']['Tables']['availability_slots']['Row'];
type BookingRow = Database['public']['Tables']['bookings']['Row'];
type SelectedSlot = SlotRow & { freeSeats: number; isMine: boolean; isFull: boolean };

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
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [selectedSlot, setSelectedSlot] = useState<SelectedSlot | null>(null);
  const [bookingType, setBookingType] = useState<1 | 2>(1);
  const [partnerFirstName, setPartnerFirstName] = useState('');
  const [partnerLastName, setPartnerLastName] = useState('');

  const { data: creditSummary } = useQuery<StudentCreditSummary>({
    queryKey: ['credit-summary', user?.id],
    queryFn: async () => {
      if (!user) {
        return {
          totalCredits: 0,
          usedCredits: 0,
          remainingCredits: 0,
          nextExpirationAt: null,
        };
      }
      return fetchStudentCreditSummary(user.id);
    },
    enabled: !!user,
  });

  // Slots
  const { data: slots = [] } = useQuery<SlotRow[]>({
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
      return data ?? [];
    },
    enabled: !!dateRange.start,
  });

  const calendarWindow = useMemo(() => getCalendarWindow(slots), [slots]);

  // Bookings for these slots
  const slotIds = slots.map((s) => s.id);
  const { data: bookings = [] } = useQuery<BookingRow[]>({
    queryKey: ['bookings-for-slots', slotIds],
    queryFn: async () => {
      if (!slotIds.length) return [];
      const { data, error } = await supabase
        .from('bookings')
        .select('*')
        .in('slot_id', slotIds)
        .eq('status', 'booked');
      if (error) throw error;
      return data ?? [];
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

  const renderEventContent = (eventInfo: EventContentArg) => {
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
    mutationFn: ({
      slotId,
      seats,
      partnerFirst,
      partnerLast,
    }: {
      slotId: string;
      seats: number;
      partnerFirst?: string | null;
      partnerLast?: string | null;
    }) => bookSlot(slotId, seats, partnerFirst, partnerLast),
    onSuccess: () => {
      toast.success('Aula agendada com sucesso!');
      setSelectedSlot(null);
      queryClient.invalidateQueries({ queryKey: ['slots'] });
      queryClient.invalidateQueries({ queryKey: ['bookings-for-slots'] });
      queryClient.invalidateQueries({ queryKey: ['credit-summary'] });
      queryClient.invalidateQueries({ queryKey: ['student-home', 'credit-summary'] });
      queryClient.invalidateQueries({ queryKey: ['credit-purchase-history'] });
      queryClient.invalidateQueries({ queryKey: ['my-bookings'] });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Erro ao agendar';
      toast.error(message);
    },
  });

  const waitlistMutation = useMutation({
    mutationFn: (slotId: string) => joinWaitlist(slotId),
    onSuccess: () => {
      toast.success('Adicionado à lista de espera!');
      setSelectedSlot(null);
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Erro ao entrar na lista';
      toast.error(message);
    },
  });

  const handleEventClick = (info: EventClickArg) => {
    const { slot, freeSeats, isMine, isFull } = info.event.extendedProps;
    setSelectedSlot({ ...slot, freeSeats, isMine, isFull });
    setBookingType(1);
    setPartnerFirstName('');
    setPartnerLastName('');
  };

  const handleDatesSet = (dateInfo: DatesSetArg) => {
    setDateRange({
      start: dateInfo.start.toISOString(),
      end: dateInfo.end.toISOString(),
    });
  };

  const handleDateClick = (info: DateClickArg) => {
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

  const usedCredits = creditSummary?.usedCredits ?? 0;
  const totalCredits = creditSummary?.totalCredits ?? 0;
  const remaining = creditSummary?.remainingCredits ?? 0;
  const isPartnerRequired = bookingType === 2;
  const isPartnerMissing = isPartnerRequired && (!partnerFirstName.trim() || !partnerLastName.trim());

  return (
    <div className="space-y-4 p-4">
      {/* Credits card */}
      <div className="rounded-xl border border-border bg-card p-4 animate-fade-in">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-display">
              Créditos ativos
            </p>
            <p className="mt-1 text-xl font-bold text-foreground font-display sm:text-2xl">
              <span className="text-primary">{usedCredits}</span>
              <span className="text-muted-foreground">/{totalCredits}</span>
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xs text-muted-foreground">Restantes</p>
            <p className={`text-lg font-bold font-display sm:text-xl ${remaining <= 0 ? 'text-destructive' : 'text-primary'}`}>{remaining}</p>
          </div>
        </div>
      </div>

      {/* Calendar */}
      <div className="rounded-xl border border-border bg-card p-2 sm:p-4 animate-fade-in">
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, luxonPlugin]}
          initialView={isMobile ? 'timeGridDay' : 'dayGridMonth'}
          headerToolbar={{
            left: isMobile ? 'prev title next' : 'prev,next today',
            center: isMobile ? '' : 'title',
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

      <button
        type="button"
        onClick={() => navigate('/plans')}
        aria-label="Comprar créditos"
        title="Comprar créditos"
        className="credit-shortcut-animate fixed right-4 z-40 inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 active:scale-95 sm:h-14 sm:w-14"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 6.75rem)' }}
      >
        <Plus className="h-6 w-6 sm:h-7 sm:w-7" />
      </button>

      {/* Booking Modal */}
      <Dialog
        open={!!selectedSlot}
        onOpenChange={() => {
          setSelectedSlot(null);
          setPartnerFirstName('');
          setPartnerLastName('');
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto bg-card border-border sm:max-w-md">
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
                        onClick={() => {
                          setBookingType(1);
                          setPartnerFirstName('');
                          setPartnerLastName('');
                        }}
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
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">
                          Dupla ocupa 2 vagas, usa credito em dupla e o parceiro deve ser aluno da Alliance Sao Jose dos Pinhais.
                        </p>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <Input
                            value={partnerFirstName}
                            onChange={(event) => setPartnerFirstName(event.target.value)}
                            placeholder="Nome do parceiro"
                            className="bg-background"
                            maxLength={80}
                          />
                          <Input
                            value={partnerLastName}
                            onChange={(event) => setPartnerLastName(event.target.value)}
                            placeholder="Sobrenome do parceiro"
                            className="bg-background"
                            maxLength={120}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Informe nome e sobrenome para validar o aluno parceiro.
                        </p>
                      </div>
                    )}
                  </div>

                  <Button
                    onClick={() => {
                      if (isPartnerMissing) {
                        toast.error('Informe nome e sobrenome do segundo aluno para agendar em dupla.');
                        return;
                      }

                      bookMutation.mutate({
                        slotId: selectedSlot.id,
                        seats: bookingType,
                        partnerFirst: bookingType === 2 ? partnerFirstName.trim() : null,
                        partnerLast: bookingType === 2 ? partnerLastName.trim() : null,
                      });
                    }}
                    disabled={bookMutation.isPending || isPartnerMissing}
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



