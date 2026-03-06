import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { Database } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Plus, Clock, Trash2, Lock } from 'lucide-react';
import { DEFAULT_LESSON_DURATION, DEFAULT_SLOT_CAPACITY } from '@/lib/constants';

const SAO_PAULO_TZ = 'America/Sao_Paulo';
const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

type SlotRow = Database['public']['Tables']['availability_slots']['Row'];

const toUtcIso = (dateTime: DateTime) => {
  const iso = dateTime.toUTC().toISO({ suppressMilliseconds: true });
  if (!iso) throw new Error('Não foi possível converter data/hora.');
  return iso;
};

const buildSaoPauloDateTime = (date: string, time: string) => {
  const parsed = DateTime.fromISO(`${date}T${time}`, { zone: SAO_PAULO_TZ });
  if (!parsed.isValid) throw new Error('Data ou horário inválido.');
  return parsed;
};

const getSaoPauloDateTimeFromIso = (isoDate: string) => {
  const parsed = DateTime.fromISO(isoDate, { zone: 'utc' }).setZone(SAO_PAULO_TZ);
  if (!parsed.isValid) throw new Error('Horário salvo inválido.');
  return parsed;
};

const getJsWeekday = (dateTime: DateTime) => dateTime.weekday % 7;

const AdminSlotsPage = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [recOpen, setRecOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);

  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState(DEFAULT_LESSON_DURATION);
  const [capacity, setCapacity] = useState(DEFAULT_SLOT_CAPACITY);

  const [recDays, setRecDays] = useState<number[]>([]);
  const [recTime, setRecTime] = useState('');
  const [recStartDate, setRecStartDate] = useState('');
  const [recEndDate, setRecEndDate] = useState('');
  const [recCapacity, setRecCapacity] = useState(DEFAULT_SLOT_CAPACITY);

  const [batchDays, setBatchDays] = useState<number[]>([]);
  const [batchStartDate, setBatchStartDate] = useState('');
  const [batchEndDate, setBatchEndDate] = useState('');
  const [batchCurrentTime, setBatchCurrentTime] = useState('');
  const [batchAction, setBatchAction] = useState<'edit' | 'delete'>('edit');
  const [batchNewTime, setBatchNewTime] = useState('');
  const [batchDuration, setBatchDuration] = useState(DEFAULT_LESSON_DURATION);
  const [batchCapacity, setBatchCapacity] = useState(DEFAULT_SLOT_CAPACITY);

  const toggleDay = (
    setter: React.Dispatch<React.SetStateAction<number[]>>,
    day: number,
  ) => {
    setter((prev) =>
      prev.includes(day)
        ? prev.filter((d) => d !== day)
        : [...prev, day].sort((a, b) => a - b),
    );
  };

  const { data: slots = [], isLoading } = useQuery({
    queryKey: ['admin-all-slots'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('availability_slots')
        .select('*')
        .gte('start_time', new Date().toISOString())
        .order('start_time')
        .limit(200);

      if (error) throw error;
      return data;
    },
  });

  const createSlotMutation = useMutation({
    mutationFn: async () => {
      if (!date || !time) throw new Error('Preencha data e horário.');
      if (duration <= 0) throw new Error('Duração inválida.');
      if (capacity <= 0) throw new Error('Capacidade invalida.');

      const startTime = buildSaoPauloDateTime(date, time);
      const endTime = startTime.plus({ minutes: duration });

      const { error } = await supabase.from('availability_slots').insert({
        start_time: toUtcIso(startTime),
        end_time: toUtcIso(endTime),
        capacity,
        created_by: user?.id || null,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Horário criado.');
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ['admin-all-slots'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const createRecurrenceMutation = useMutation({
    mutationFn: async () => {
      if (!recDays.length) throw new Error('Selecione pelo menos um dia da semana.');
      if (!recTime || !recStartDate || !recEndDate) {
        throw new Error('Preencha horário e período da recorrência.');
      }
      if (duration <= 0) throw new Error('Duração inválida.');
      if (recCapacity <= 0) throw new Error('Capacidade invalida.');

      const startDate = DateTime.fromISO(recStartDate, { zone: SAO_PAULO_TZ }).startOf('day');
      const endDate = DateTime.fromISO(recEndDate, { zone: SAO_PAULO_TZ }).startOf('day');

      if (!startDate.isValid || !endDate.isValid) throw new Error('Período inválido.');
      if (endDate < startDate) throw new Error('Data final deve ser maior ou igual a inicial.');

      const slotsToInsert: Database['public']['Tables']['availability_slots']['Insert'][] = [];
      let cursor = startDate;

      while (cursor <= endDate) {
        if (recDays.includes(getJsWeekday(cursor))) {
          const slotStart = buildSaoPauloDateTime(cursor.toISODate() || '', recTime);
          const slotEnd = slotStart.plus({ minutes: duration });

          slotsToInsert.push({
            start_time: toUtcIso(slotStart),
            end_time: toUtcIso(slotEnd),
            capacity: recCapacity,
            created_by: user?.id || null,
          });
        }

        cursor = cursor.plus({ days: 1 });
      }

      if (!slotsToInsert.length) throw new Error('Nenhum horário foi gerado.');

      const { error } = await supabase.from('availability_slots').insert(slotsToInsert);
      if (error) throw error;

      return slotsToInsert.length;
    },
    onSuccess: (count) => {
      toast.success(`${count} horários criados.`);
      setRecOpen(false);
      queryClient.invalidateQueries({ queryKey: ['admin-all-slots'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const batchMutation = useMutation({
    mutationFn: async () => {
      if (!batchDays.length) throw new Error('Selecione pelo menos um dia da semana.');
      if (!batchStartDate || !batchEndDate) throw new Error('Preencha o período da recorrência.');

      const rangeStart = DateTime.fromISO(batchStartDate, { zone: SAO_PAULO_TZ }).startOf('day');
      const rangeEnd = DateTime.fromISO(batchEndDate, { zone: SAO_PAULO_TZ }).endOf('day');

      if (!rangeStart.isValid || !rangeEnd.isValid) throw new Error('Período inválido.');
      if (rangeEnd < rangeStart) throw new Error('Data final deve ser maior ou igual a inicial.');

      if (batchAction === 'edit') {
        if (!batchNewTime) throw new Error('Informe o novo horário.');
        if (batchDuration <= 0) throw new Error('Duração inválida.');
        if (batchCapacity <= 0) throw new Error('Capacidade invalida.');
      }

      const { data, error } = await supabase
        .from('availability_slots')
        .select('*')
        .gte('start_time', toUtcIso(rangeStart))
        .lte('start_time', toUtcIso(rangeEnd))
        .order('start_time');

      if (error) throw error;

      const filteredSlots = (data || []).filter((slot) => {
        const slotStart = getSaoPauloDateTimeFromIso(slot.start_time);
        const weekdayMatches = batchDays.includes(getJsWeekday(slotStart));
        const timeMatches = !batchCurrentTime || slotStart.toFormat('HH:mm') === batchCurrentTime;
        return weekdayMatches && timeMatches;
      });

      if (!filteredSlots.length) {
        throw new Error('Nenhum horário encontrado com os filtros informados.');
      }

      if (batchAction === 'delete') {
        const ids = filteredSlots.map((slot) => slot.id);
        const { error: deleteError } = await supabase
          .from('availability_slots')
          .delete()
          .in('id', ids);

        if (deleteError) throw deleteError;
        return { count: ids.length, action: 'delete' as const };
      }

      await Promise.all(
        filteredSlots.map(async (slot) => {
          const currentStart = getSaoPauloDateTimeFromIso(slot.start_time);
          const newStart = buildSaoPauloDateTime(currentStart.toISODate() || '', batchNewTime);
          const newEnd = newStart.plus({ minutes: batchDuration });

          const { error: updateError } = await supabase
            .from('availability_slots')
            .update({
              start_time: toUtcIso(newStart),
              end_time: toUtcIso(newEnd),
              capacity: batchCapacity,
            })
            .eq('id', slot.id);

          if (updateError) throw updateError;
        }),
      );

      return { count: filteredSlots.length, action: 'edit' as const };
    },
    onSuccess: ({ count, action }) => {
      toast.success(
        action === 'delete'
          ? `${count} horários excluídos em recorrência.`
          : `${count} horários atualizados em recorrência.`,
      );
      setBatchOpen(false);
      queryClient.invalidateQueries({ queryKey: ['admin-all-slots'] });
    },
    onError: (err: Error) => toast.error(err.message),
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
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteSlot = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('availability_slots').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Horário excluído.');
      queryClient.invalidateQueries({ queryKey: ['admin-all-slots'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-xl uppercase tracking-wider">Horários</h1>

        <div className="flex flex-wrap gap-2">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="font-display uppercase tracking-wider">
                <Plus className="mr-1 h-4 w-4" /> Criar
              </Button>
            </DialogTrigger>
            <DialogContent className="border-border bg-card">
              <DialogHeader>
                <DialogTitle className="font-display uppercase tracking-wider">Novo horário</DialogTitle>
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
                    <Input
                      type="number"
                      min={1}
                      value={duration}
                      onChange={(e) => setDuration(Number(e.target.value))}
                      className="bg-background"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Capacidade</Label>
                    <Input
                      type="number"
                      min={1}
                      value={capacity}
                      onChange={(e) => setCapacity(Number(e.target.value))}
                      className="bg-background"
                    />
                  </div>
                </div>

                <Button
                  onClick={() => createSlotMutation.mutate()}
                  disabled={createSlotMutation.isPending}
                  className="w-full font-display uppercase"
                >
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
            <DialogContent className="border-border bg-card">
              <DialogHeader>
                <DialogTitle className="font-display uppercase tracking-wider">Horários recorrentes</DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Dias da semana</Label>
                  <div className="flex flex-wrap gap-2">
                    {dayNames.map((name, index) => (
                      <button
                        key={index}
                        type="button"
                        onClick={() => toggleDay(setRecDays, index)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                          recDays.includes(index)
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
                    <Input
                      type="date"
                      value={recStartDate}
                      onChange={(e) => setRecStartDate(e.target.value)}
                      className="bg-background"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Até</Label>
                    <Input
                      type="date"
                      value={recEndDate}
                      onChange={(e) => setRecEndDate(e.target.value)}
                      className="bg-background"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label>Capacidade</Label>
                  <Input
                    type="number"
                    min={1}
                    value={recCapacity}
                    onChange={(e) => setRecCapacity(Number(e.target.value))}
                    className="bg-background"
                  />
                </div>

                <Button
                  onClick={() => createRecurrenceMutation.mutate()}
                  disabled={createRecurrenceMutation.isPending}
                  className="w-full font-display uppercase"
                >
                  {createRecurrenceMutation.isPending ? 'Criando...' : 'Criar horários'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={batchOpen} onOpenChange={setBatchOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="secondary" className="font-display uppercase tracking-wider">
                Editar recorrência
              </Button>
            </DialogTrigger>
            <DialogContent className="border-border bg-card">
              <DialogHeader>
                <DialogTitle className="font-display uppercase tracking-wider">Editar em recorrência</DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Dias da semana</Label>
                  <div className="flex flex-wrap gap-2">
                    {dayNames.map((name, index) => (
                      <button
                        key={index}
                        type="button"
                        onClick={() => toggleDay(setBatchDays, index)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                          batchDays.includes(index)
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>De</Label>
                    <Input
                      type="date"
                      value={batchStartDate}
                      onChange={(e) => setBatchStartDate(e.target.value)}
                      className="bg-background"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Até</Label>
                    <Input
                      type="date"
                      value={batchEndDate}
                      onChange={(e) => setBatchEndDate(e.target.value)}
                      className="bg-background"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label>Horário atual (opcional)</Label>
                  <Input
                    type="time"
                    value={batchCurrentTime}
                    onChange={(e) => setBatchCurrentTime(e.target.value)}
                    className="bg-background"
                  />
                </div>

                <div className="space-y-1">
                  <Label>Ação</Label>
                  <Select
                    value={batchAction}
                    onValueChange={(value: 'edit' | 'delete') => setBatchAction(value)}
                  >
                    <SelectTrigger className="bg-background">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="edit">Editar</SelectItem>
                      <SelectItem value="delete">Excluir</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {batchAction === 'edit' && (
                  <div className="space-y-3 rounded-lg border border-border p-3">
                    <div className="space-y-1">
                      <Label>Novo horário</Label>
                      <Input
                        type="time"
                        value={batchNewTime}
                        onChange={(e) => setBatchNewTime(e.target.value)}
                        className="bg-background"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label>Duração (min)</Label>
                        <Input
                          type="number"
                          min={1}
                          value={batchDuration}
                          onChange={(e) => setBatchDuration(Number(e.target.value))}
                          className="bg-background"
                        />
                      </div>

                      <div className="space-y-1">
                        <Label>Capacidade</Label>
                        <Input
                          type="number"
                          min={1}
                          value={batchCapacity}
                          onChange={(e) => setBatchCapacity(Number(e.target.value))}
                          className="bg-background"
                        />
                      </div>
                    </div>
                  </div>
                )}

                <Button
                  onClick={() => batchMutation.mutate()}
                  disabled={batchMutation.isPending}
                  variant={batchAction === 'delete' ? 'destructive' : 'default'}
                  className="w-full font-display uppercase"
                >
                  {batchMutation.isPending
                    ? batchAction === 'delete'
                      ? 'Excluindo...'
                      : 'Atualizando...'
                    : batchAction === 'delete'
                    ? 'Excluir recorrência'
                    : 'Aplicar edição'}
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
          {(slots as SlotRow[]).map((slot) => (
            <div
              key={slot.id}
              className="animate-fade-in rounded-xl border border-border bg-card p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">
                      {new Date(slot.start_time).toLocaleDateString('pt-BR', {
                        weekday: 'short',
                        day: '2-digit',
                        month: '2-digit',
                        timeZone: SAO_PAULO_TZ,
                      }).replace(/\./g, '')}{' '}
                      {new Date(slot.start_time).toLocaleTimeString('pt-BR', {
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: SAO_PAULO_TZ,
                      })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Cap: {slot.capacity} - {slot.status === 'blocked' ? 'Bloqueado' : 'Disponível'}
                    </p>
                  </div>
                </div>

                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => toggleBlock.mutate({ id: slot.id, currentStatus: slot.status })}
                    disabled={toggleBlock.isPending}
                  >
                    <Lock className="h-4 w-4" />
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteSlot.mutate(slot.id)}
                    disabled={deleteSlot.isPending}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminSlotsPage;

