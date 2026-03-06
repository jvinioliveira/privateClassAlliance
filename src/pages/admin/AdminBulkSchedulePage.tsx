import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { adminBulkBook } from '@/hooks/useSupabaseData';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, XCircle } from 'lucide-react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import luxonPlugin from '@fullcalendar/luxon3';
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

const AdminBulkSchedulePage = () => {
  const isMobile = useIsMobile();
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [selectedSlotIds, setSelectedSlotIds] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [results, setResults] = useState<any[]>([]);

  const { data: students = [] } = useQuery({
    queryKey: ['admin-students-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'student')
        .order('full_name');
      if (error) throw error;
      return data;
    },
  });

  const { data: slots = [] } = useQuery({
    queryKey: ['bulk-slots', dateRange.start, dateRange.end],
    queryFn: async () => {
      if (!dateRange.start) return [];
      const { data, error } = await supabase
        .from('availability_slots')
        .select('*')
        .gte('start_time', dateRange.start)
        .lte('start_time', dateRange.end)
        .eq('status', 'available')
        .order('start_time');
      if (error) throw error;
      return data;
    },
    enabled: !!dateRange.start,
  });

  const events = useMemo(() => {
    return slots.map((slot) => ({
      id: slot.id,
      title: selectedSlotIds.includes(slot.id) ? 'Selecionado' : 'Disponível',
      start: slot.start_time,
      end: slot.end_time,
      backgroundColor: selectedSlotIds.includes(slot.id)
        ? 'hsl(43 72% 52%)'
        : 'hsl(0 0% 20%)',
      textColor: selectedSlotIds.includes(slot.id) ? 'hsl(0 0% 5%)' : 'hsl(0 0% 70%)',
      borderColor: 'transparent',
    }));
  }, [slots, selectedSlotIds]);

  const calendarWindow = useMemo(() => getCalendarWindow(slots), [slots]);

  const bulkMutation = useMutation({
    mutationFn: () => adminBulkBook(selectedStudentId, selectedSlotIds, 1),
    onSuccess: (data) => {
      setResults(data as any[]);
      const successes = (data as any[]).filter((r: any) => r.success).length;
      toast.success(`${successes} de ${selectedSlotIds.length} aulas agendadas`);
      setSelectedSlotIds([]);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const handleEventClick = (info: any) => {
    const id = info.event.id;
    setSelectedSlotIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  return (
    <div className="space-y-4">
      <h1 className="font-display text-xl uppercase tracking-wider">Pré-agendar em lote</h1>

      <div className="space-y-4 rounded-xl border border-border bg-card p-4">
        <div className="space-y-2">
          <Label>Selecionar aluno</Label>
          <Select value={selectedStudentId} onValueChange={setSelectedStudentId}>
            <SelectTrigger className="bg-background">
              <SelectValue placeholder="Escolha um aluno" />
            </SelectTrigger>
            <SelectContent>
              {students.map((s: any) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.full_name || 'Sem nome'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <p className="text-sm text-muted-foreground">
          Clique nos horários para selecionar ({selectedSlotIds.length} selecionados)
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-2 sm:p-4">
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, luxonPlugin]}
          initialView={isMobile ? 'timeGridDay' : 'timeGridWeek'}
          headerToolbar={{
            left: isMobile ? 'prev title next' : 'prev,next',
            center: isMobile ? '' : 'title',
            right: isMobile ? '' : 'timeGridWeek,timeGridDay',
          }}
          locale="pt-br"
          timeZone="America/Sao_Paulo"
          allDaySlot={false}
          dayHeaderContent={renderTimeGridHeader}
          slotMinTime={calendarWindow.slotMinTime}
          slotMaxTime={calendarWindow.slotMaxTime}
          events={events}
          eventClick={handleEventClick}
          datesSet={(info) => setDateRange({ start: info.startStr, end: info.endStr })}
          height="auto"
          eventDisplay="block"
          buttonText={{ week: 'Semana', day: 'Dia' }}
        />
      </div>

      {selectedSlotIds.length > 0 && selectedStudentId && (
        <Button
          onClick={() => bulkMutation.mutate()}
          disabled={bulkMutation.isPending}
          className="w-full font-display uppercase tracking-wider"
        >
          {bulkMutation.isPending
            ? 'Agendando...'
            : `Agendar ${selectedSlotIds.length} aula(s)`}
        </Button>
      )}

      {results.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-display text-lg uppercase tracking-wider">Resultado</h2>
          {results.map((r: any, i: number) => (
            <div key={i} className="flex items-start gap-2 rounded-lg border border-border bg-card p-3">
              {r.success ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : (
                <XCircle className="h-4 w-4 text-destructive" />
              )}
              <span className="text-sm text-foreground break-words">
                Horário {i + 1}: {r.success ? 'Agendado' : r.error}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminBulkSchedulePage;
