import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Plus, Clock, Trash2, Lock } from 'lucide-react';
import { DEFAULT_LESSON_DURATION, DEFAULT_SLOT_CAPACITY } from '@/lib/constants';

const AdminSlotsPage = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [recOpen, setRecOpen] = useState(false);

  // Single slot form
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState(DEFAULT_LESSON_DURATION);
  const [capacity, setCapacity] = useState(DEFAULT_SLOT_CAPACITY);

  // Recurrence form
  const [recDays, setRecDays] = useState<number[]>([]);
  const [recTime, setRecTime] = useState('');
  const [recStartDate, setRecStartDate] = useState('');
  const [recEndDate, setRecEndDate] = useState('');
  const [recCapacity, setRecCapacity] = useState(DEFAULT_SLOT_CAPACITY);

  const { data: slots = [], isLoading } = useQuery({
    queryKey: ['admin-all-slots'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('availability_slots')
        .select('*')
        .gte('start_time', new Date().toISOString())
        .order('start_time')
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  const createSlotMutation = useMutation({
    mutationFn: async () => {
      const startTime = new Date(`${date}T${time}:00`);
      const endTime = new Date(startTime.getTime() + duration * 60000);
      const { error } = await supabase.from('availability_slots').insert({
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        capacity,
        created_by: user?.id || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Horário criado');
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ['admin-all-slots'] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const createRecurrenceMutation = useMutation({
    mutationFn: async () => {
      const slotsToInsert: any[] = [];
      const start = new Date(recStartDate);
      const end = new Date(recEndDate);
      const current = new Date(start);

      while (current <= end) {
        if (recDays.includes(current.getDay())) {
          const [h, m] = recTime.split(':').map(Number);
          const startTime = new Date(current);
          startTime.setHours(h, m, 0, 0);
          const endTime = new Date(startTime.getTime() + duration * 60000);

          slotsToInsert.push({
            start_time: startTime.toISOString(),
            end_time: endTime.toISOString(),
            capacity: recCapacity,
            created_by: user?.id || null,
          });
        }
        current.setDate(current.getDate() + 1);
      }

      if (!slotsToInsert.length) throw new Error('Nenhum horário gerado');

      const { error } = await supabase.from('availability_slots').insert(slotsToInsert);
      if (error) throw error;
      return slotsToInsert.length;
    },
    onSuccess: (count) => {
      toast.success(`${count} horários criados`);
      setRecOpen(false);
      queryClient.invalidateQueries({ queryKey: ['admin-all-slots'] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const toggleBlock = useMutation({
    mutationFn: async ({ id, currentStatus }: { id: string; currentStatus: string }) => {
      const newStatus = currentStatus === 'blocked' ? 'available' : 'blocked';
      const { error } = await supabase
        .from('availability_slots')
        .update({ status: newStatus })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-all-slots'] });
    },
  });

  const deleteSlot = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('availability_slots').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Horário excluído');
      queryClient.invalidateQueries({ queryKey: ['admin-all-slots'] });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-xl uppercase tracking-wider">Horários</h1>
        <div className="flex gap-2">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="font-display uppercase tracking-wider">
                <Plus className="mr-1 h-4 w-4" /> Criar
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border">
              <DialogHeader>
                <DialogTitle className="font-display uppercase tracking-wider">
                  Novo horário
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Data</Label>
                    <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-background" />
                  </div>
                  <div className="space-y-1">
                    <Label>Hora</Label>
                    <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="bg-background" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Duração (min)</Label>
                    <Input type="number" value={duration} onChange={(e) => setDuration(+e.target.value)} className="bg-background" />
                  </div>
                  <div className="space-y-1">
                    <Label>Capacidade</Label>
                    <Input type="number" value={capacity} onChange={(e) => setCapacity(+e.target.value)} className="bg-background" />
                  </div>
                </div>
                <Button onClick={() => createSlotMutation.mutate()} disabled={createSlotMutation.isPending} className="w-full font-display uppercase">
                  {createSlotMutation.isPending ? 'Criando...' : 'Criar horário'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={recOpen} onOpenChange={setRecOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="font-display uppercase tracking-wider">
                Recorrência
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border">
              <DialogHeader>
                <DialogTitle className="font-display uppercase tracking-wider">
                  Horários recorrentes
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Dias da semana</Label>
                  <div className="flex flex-wrap gap-2">
                    {dayNames.map((name, i) => (
                      <button
                        key={i}
                        onClick={() =>
                          setRecDays((prev) =>
                            prev.includes(i) ? prev.filter((d) => d !== i) : [...prev, i]
                          )
                        }
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                          recDays.includes(i)
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Hora</Label>
                  <Input type="time" value={recTime} onChange={(e) => setRecTime(e.target.value)} className="bg-background" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>De</Label>
                    <Input type="date" value={recStartDate} onChange={(e) => setRecStartDate(e.target.value)} className="bg-background" />
                  </div>
                  <div className="space-y-1">
                    <Label>Até</Label>
                    <Input type="date" value={recEndDate} onChange={(e) => setRecEndDate(e.target.value)} className="bg-background" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Capacidade</Label>
                  <Input type="number" value={recCapacity} onChange={(e) => setRecCapacity(+e.target.value)} className="bg-background" />
                </div>
                <Button onClick={() => createRecurrenceMutation.mutate()} disabled={createRecurrenceMutation.isPending} className="w-full font-display uppercase">
                  {createRecurrenceMutation.isPending ? 'Criando...' : 'Criar horários'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : (
        <div className="space-y-2">
          {slots.map((slot) => (
            <div key={slot.id} className="flex items-center justify-between rounded-xl border border-border bg-card p-3 animate-fade-in">
              <div className="flex items-center gap-3">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">
                    {new Date(slot.start_time).toLocaleDateString('pt-BR', {
                      weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo',
                    })}{' '}
                    {new Date(slot.start_time).toLocaleTimeString('pt-BR', {
                      hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
                    })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Cap: {slot.capacity} · {slot.status === 'blocked' ? '🔒 Bloqueado' : '✓ Disponível'}
                  </p>
                </div>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => toggleBlock.mutate({ id: slot.id, currentStatus: slot.status })}
                >
                  <Lock className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => deleteSlot.mutate(slot.id)}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminSlotsPage;
