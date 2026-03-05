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

const AdminBulkSchedulePage = () => {
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
      title: selectedSlotIds.includes(slot.id) ? '✓ Selecionado' : 'Disponível',
      start: slot.start_time,
      end: slot.end_time,
      backgroundColor: selectedSlotIds.includes(slot.id)
        ? 'hsl(43 72% 52%)'
        : 'hsl(0 0% 20%)',
      textColor: selectedSlotIds.includes(slot.id) ? 'hsl(0 0% 5%)' : 'hsl(0 0% 70%)',
      borderColor: 'transparent',
    }));
  }, [slots, selectedSlotIds]);

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

      <div className="rounded-xl border border-border bg-card p-4 space-y-4">
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
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          headerToolbar={{
            left: 'prev,next',
            center: 'title',
            right: 'timeGridWeek,timeGridDay',
          }}
          locale="pt-br"
          timeZone="America/Sao_Paulo"
          events={events}
          eventClick={handleEventClick}
          datesSet={(info) => setDateRange({ start: info.startStr, end: info.endStr })}
          height="auto"
          eventDisplay="block"
          slotMinTime="06:00:00"
          slotMaxTime="22:00:00"
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
            <div key={i} className="flex items-center gap-2 rounded-lg border border-border bg-card p-3">
              {r.success ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : (
                <XCircle className="h-4 w-4 text-destructive" />
              )}
              <span className="text-sm text-foreground">
                Slot {i + 1}: {r.success ? 'Agendado' : r.error}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminBulkSchedulePage;
