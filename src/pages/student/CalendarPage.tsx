import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
type WalletRow = Database['public']['Tables']['student_plan_selections']['Row'];
type SelectedSlot = SlotRow & {
  freeSeats: number;
  isMine: boolean;
  isFull: boolean;
  isUnavailableByTime: boolean;
  unavailableReason: string | null;
};

const BOOKING_MIN_LEAD_MINUTES = 30;

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

  const hourlyMin = Math.max(0, Math.floor(minStart / 60) * 60);
  const hourlyMax = Math.min(24 * 60, Math.ceil(maxEnd / 60) * 60);

  return {
    slotMinTime: toCalendarTime(hourlyMin),
    slotMaxTime: toCalendarTime(Math.max(hourlyMax, hourlyMin + 60)),
  };
};

const getSlotUnavailabilityInfo = (slotStartIso: string, nowMs = Date.now()) => {
  const slotStartMs = new Date(slotStartIso).getTime();
  if (!Number.isFinite(slotStartMs)) {
    return {
      isUnavailableByTime: true,
      unavailableReason: 'Este horÃ¡rio estÃ¡ indisponÃ­vel.',
    };
  }

  const diffMs = slotStartMs - nowMs;
  if (diffMs <= 0) {
    return {
      isUnavailableByTime: true,
      unavailableReason: 'Este horÃ¡rio estÃ¡ indisponÃ­vel porque jÃ¡ passou.',
    };
  }

  if (diffMs <= BOOKING_MIN_LEAD_MINUTES * 60 * 1000) {
    return {
      isUnavailableByTime: true,
      unavailableReason: 'Agendamento indisponÃ­vel com menos de 30 minutos de antecedÃªncia.',
    };
  }

  return {
    isUnavailableByTime: false,
    unavailableReason: null,
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
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 15000);

    return () => window.clearInterval(timer);
  }, []);

  const { data: activeWallets = [], isLoading: isLoadingWallets } = useQuery<WalletRow[]>({
    queryKey: ['student-active-wallets', user?.id],
    queryFn: async () => {
      if (!user) return [];

      const { data, error } = await supabase
        .from('student_plan_selections')
        .select('*')
        .eq('student_id', user.id)
        .eq('status', 'active')
        .order('selected_at', { ascending: false })
        .order('updated_at', { ascending: false });

      if (error) throw error;
      return (data ?? []) as WalletRow[];
    },
    enabled: !!user,
  });

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

  const slotIds = slots.map((s) => s.id);
  const { data: bookings = [] } = useQuery<BookingRow[]>({
    queryKey: ['bookings-for-slots', slotIds],
    queryFn: async () => {
      if (!slotIds.length) return [];
      const { data, error } = await supabase.from('bookings').select('*').in('slot_id', slotIds).eq('status', 'booked');
      if (error) throw error;
      return data ?? [];
    },
    enabled: slotIds.length > 0,
  });

  const creditBalances = useMemo(() => {
    const now = Date.now();
    const latestByClassType = new Map<'individual' | 'double', WalletRow>();

    for (const wallet of activeWallets) {
      const classType = wallet.class_type === 'double' ? 'double' : 'individual';
      if (!latestByClassType.has(classType)) {
        latestByClassType.set(classType, wallet);
      }
    }

    const getValidRemainingCredits = (wallet: WalletRow | undefined) => {
      if (!wallet) return 0;
      const expiresAtMs = new Date(wallet.expires_at).getTime();
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) return 0;
      return Math.max(wallet.remaining_credits ?? 0, 0);
    };

    const individualRemaining = getValidRemainingCredits(latestByClassType.get('individual'));
    const doubleRemaining = getValidRemainingCredits(latestByClassType.get('double'));

    return {
      individualRemaining,
      doubleRemaining,
      totalRemaining: individualRemaining + doubleRemaining,
    };
  }, [activeWallets]);

  const walletAvailability = useMemo(() => {
    const hasIndividualCredit = creditBalances.individualRemaining > 0;
    const hasDoubleCredit = creditBalances.doubleRemaining > 0;

    return {
      hasIndividualCredit,
      hasDoubleCredit,
      canChooseType: hasIndividualCredit && hasDoubleCredit,
      onlyIndividual: hasIndividualCredit && !hasDoubleCredit,
      onlyDouble: hasDoubleCredit && !hasIndividualCredit,
      hasNoCredits: !hasIndividualCredit && !hasDoubleCredit,
    };
  }, [creditBalances]);

  const events = useMemo(() => {
    return slots.map((slot) => {
      const slotBookings = bookings.filter((b) => b.slot_id === slot.id);
      const usedSeats = slotBookings.reduce((sum, b) => sum + b.seats_reserved, 0);
      const isOccupied = slotBookings.length > 0;
      const freeSeats = isOccupied ? 0 : slot.capacity;
      const isMine = slotBookings.some((b) => b.student_id === user?.id);
      const isFull = isOccupied;
      const { isUnavailableByTime, unavailableReason } = getSlotUnavailabilityInfo(slot.start_time, nowMs);

      const statusLabel = isMine
        ? 'Agendado'
        : isUnavailableByTime
        ? 'IndisponÃ­vel'
        : isFull
        ? 'Ocupado'
        : 'DisponÃ­vel';

      return {
        id: slot.id,
        title: statusLabel,
        start: slot.start_time,
        end: slot.end_time,
        backgroundColor: isMine
          ? 'hsl(120 40% 30%)'
          : isUnavailableByTime
          ? 'hsl(0 0% 45%)'
          : isFull
          ? 'hsl(0 65% 42%)'
          : 'hsl(43 72% 52%)',
        textColor: isMine || isUnavailableByTime ? 'hsl(0 0% 95%)' : isFull ? 'hsl(0 0% 95%)' : 'hsl(0 0% 5%)',
        borderColor: 'transparent',
        extendedProps: {
          slot,
          freeSeats,
          isMine,
          isFull,
          isUnavailableByTime,
          unavailableReason,
          usedSeats,
          timeLabel: formatTimeWithH(slot.start_time),
          statusLabel,
        },
      };
    });
  }, [slots, bookings, user, nowMs]);

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
      toast.success('Adicionado Ã  lista de espera!');
      setSelectedSlot(null);
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Erro ao entrar na lista';
      toast.error(message);
    },
  });

  const handleEventClick = (info: EventClickArg) => {
    if (isMobile && info.view.type === 'dayGridMonth') {
      info.view.calendar.changeView('timeGridDay', info.event.startStr);
      return;
    }

    const { slot, freeSeats, isMine, isFull, isUnavailableByTime, unavailableReason } = info.event.extendedProps;
    setSelectedSlot({ ...slot, freeSeats, isMine, isFull, isUnavailableByTime, unavailableReason });
    if (walletAvailability.onlyDouble) {
      setBookingType(2);
    } else {
      setBookingType(1);
    }
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

  useEffect(() => {
    if (!selectedSlot) return;

    if (walletAvailability.onlyDouble && bookingType !== 2) {
      setBookingType(2);
      return;
    }

    if (walletAvailability.onlyIndividual && bookingType !== 1) {
      setBookingType(1);
      setPartnerFirstName('');
      setPartnerLastName('');
    }
  }, [selectedSlot, walletAvailability.onlyDouble, walletAvailability.onlyIndividual, bookingType]);

  const individualCredits = creditBalances.individualRemaining;
  const doubleCredits = creditBalances.doubleRemaining;
  const totalCredits = creditBalances.totalRemaining;
  const hasIndividualCredit = walletAvailability.hasIndividualCredit;
  const hasDoubleCredit = walletAvailability.hasDoubleCredit;
  const canChooseBookingType = walletAvailability.canChooseType;
  const onlyIndividualCredit = walletAvailability.onlyIndividual;
  const onlyDoubleCredit = walletAvailability.onlyDouble;
  const hasNoCredits = walletAvailability.hasNoCredits;
  const isPartnerRequired = bookingType === 2;
  const isPartnerMissing = isPartnerRequired && (!partnerFirstName.trim() || !partnerLastName.trim());
  const canConfirmBooking = !isLoadingWallets && !hasNoCredits && !isPartnerMissing;
  const selectedSlotUnavailability = useMemo(() => {
    if (!selectedSlot) {
      return {
        isUnavailableByTime: false,
        unavailableReason: null as string | null,
      };
    }

    return getSlotUnavailabilityInfo(selectedSlot.start_time, nowMs);
  }, [selectedSlot, nowMs]);
  const isSelectedSlotUnavailableByTime = selectedSlotUnavailability.isUnavailableByTime;
  const selectedSlotUnavailableReason = selectedSlotUnavailability.unavailableReason;

  return (
    <div className="space-y-4 p-4">
      <div className="rounded-xl border border-border bg-card p-4 animate-fade-in">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-display uppercase tracking-wider text-muted-foreground">Saldos de créditos</p>
            <p className="text-sm font-medium text-foreground">Total: {totalCredits}</p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-border/70 bg-background/60 p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Créditos individuais</p>
              <p className={`mt-1 text-lg font-semibold ${individualCredits > 0 ? 'text-primary' : 'text-muted-foreground'}`}>
                {individualCredits}
              </p>
            </div>

            <div className="rounded-lg border border-border/70 bg-background/60 p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Créditos em dupla</p>
              <p className={`mt-1 text-lg font-semibold ${doubleCredits > 0 ? 'text-primary' : 'text-muted-foreground'}`}>
                {doubleCredits}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-2 animate-fade-in sm:p-4">
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
          fixedWeekCount={false}
          slotDuration="01:00:00"
          slotLabelInterval="01:00:00"
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
          dayMaxEvents={isMobile ? false : 3}
          dayMaxEventRows={isMobile ? false : undefined}
          buttonText={{
            today: 'Hoje',
            month: 'MÃªs',
            week: 'Semana',
            day: 'Dia',
          }}
        />
      </div>

      <button
        type="button"
        onClick={() => navigate('/plans')}
        aria-label="Comprar crÃ©ditos"
        title="Comprar crÃ©ditos"
        className="credit-shortcut-animate fixed right-4 z-40 inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 active:scale-95 sm:h-14 sm:w-14"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 6.75rem)' }}
      >
        <Plus className="h-6 w-6 sm:h-7 sm:w-7" />
      </button>

      <Dialog
        open={!!selectedSlot}
        onOpenChange={() => {
          setSelectedSlot(null);
          setPartnerFirstName('');
          setPartnerLastName('');
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto border-border bg-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-lg uppercase tracking-wider">
              {selectedSlot?.isMine
                ? 'Aula agendada'
                : isSelectedSlotUnavailableByTime
                ? 'HorÃ¡rio indisponÃ­vel'
                : selectedSlot?.isFull
                ? 'HorÃ¡rio ocupado'
                : 'Agendar aula'}
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
                  às {formatTimeWithH(selectedSlot.start_time)}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Badge variant={isSelectedSlotUnavailableByTime ? 'secondary' : selectedSlot.isFull ? 'destructive' : 'default'}>
                  {isSelectedSlotUnavailableByTime ? 'IndisponÃ­vel' : selectedSlot.isFull ? 'Ocupado' : 'DisponÃ­vel'}
                </Badge>
              </div>

              {selectedSlot.isMine ? (
                <p className="text-sm text-muted-foreground">VocÃª jÃ¡ estÃ¡ agendado para este horÃ¡rio.</p>
              ) : isSelectedSlotUnavailableByTime ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                    <span>{selectedSlotUnavailableReason || 'Este horÃ¡rio estÃ¡ indisponÃ­vel para agendamento.'}</span>
                  </div>
                </div>
              ) : selectedSlot.isFull ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                    <span>Este horÃ¡rio jÃ¡ estÃ¡ ocupado.</span>
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
                  {isLoadingWallets ? (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">Carregando seus crÃ©ditos...</p>
                    </div>
                  ) : hasNoCredits ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <AlertTriangle className="h-4 w-4 text-destructive" />
                        <span>VocÃª nÃ£o tem crÃ©ditos ativos para agendar este horÃ¡rio.</span>
                      </div>
                      <Button variant="outline" className="w-full" onClick={() => navigate('/plans')}>
                        Comprar crÃ©ditos
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-2">
                        {canChooseBookingType ? (
                          <>
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
                                className={`flex items-center justify-center gap-2 rounded-lg border p-3 text-sm transition-colors ${
                                  bookingType === 2
                                    ? 'border-primary bg-primary/10 text-primary'
                                    : 'border-border text-muted-foreground hover:border-primary/50'
                                }`}
                              >
                                <Users className="h-4 w-4" />
                                Dupla
                              </button>
                            </div>
                          </>
                        ) : onlyIndividualCredit ? (
                          <p className="rounded-md border border-border/70 bg-background/60 p-2 text-xs text-muted-foreground">
                            Seus crÃ©ditos ativos sÃ£o individuais. O agendamento serÃ¡ feito automaticamente como aula individual.
                          </p>
                        ) : onlyDoubleCredit ? (
                          <p className="rounded-md border border-border/70 bg-background/60 p-2 text-xs text-muted-foreground">
                            Seus crÃ©ditos ativos sÃ£o em dupla. O agendamento serÃ¡ feito automaticamente como aula em dupla.
                          </p>
                        ) : null}

                        {bookingType === 2 && (
                          <div className="space-y-2">
                            <p className="text-xs text-muted-foreground">
                              Aula em dupla exige crÃ©dito de dupla e nome/sobrenome do parceiro (aluno cadastrado).
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
                          if (isSelectedSlotUnavailableByTime) {
                            toast.error(selectedSlotUnavailableReason || 'Este horÃ¡rio estÃ¡ indisponÃ­vel para agendamento.');
                            return;
                          }

                          if (hasNoCredits) {
                            toast.error('VocÃª nÃ£o possui crÃ©ditos ativos para agendar.');
                            return;
                          }

                          if (isLoadingWallets) {
                            toast.error('Aguarde o carregamento dos crÃ©ditos para continuar.');
                            return;
                          }

                          if (bookingType === 1 && !hasIndividualCredit) {
                            toast.error('VocÃª nÃ£o possui crÃ©ditos de aula individual.');
                            return;
                          }

                          if (bookingType === 2 && !hasDoubleCredit) {
                            toast.error('VocÃª nÃ£o possui crÃ©ditos de aula em dupla.');
                            return;
                          }

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
                        disabled={bookMutation.isPending || !canConfirmBooking}
                        className="w-full font-display uppercase tracking-wider"
                      >
                        {bookMutation.isPending ? 'Agendando...' : `Confirmar agendamento ${bookingType === 2 ? 'em dupla' : 'individual'}`}
                      </Button>
                    </>
                  )}
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
