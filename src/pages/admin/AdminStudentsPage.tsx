import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Users, Edit } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type StudentProfile = Database['public']['Tables']['profiles']['Row'];
type StudentCredit = Database['public']['Tables']['student_month_credits']['Row'];

const AdminStudentsPage = () => {
  const queryClient = useQueryClient();
  const [selectedStudent, setSelectedStudent] = useState<StudentProfile | null>(null);
  const [monthInput, setMonthInput] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [limitInput, setLimitInput] = useState(0);

  const { data: students = [], isLoading } = useQuery({
    queryKey: ['admin-students'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'student')
        .order('full_name');
      if (error) throw error;
      return (data || []) as StudentProfile[];
    },
  });

  const monthRef = `${monthInput}-01`;

  const { data: credits = [] } = useQuery({
    queryKey: ['admin-credits', monthRef],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('student_month_credits')
        .select('*')
        .eq('month_ref', monthRef);
      if (error) throw error;
      return (data || []) as StudentCredit[];
    },
  });

  const saveCreditMutation = useMutation({
    mutationFn: async () => {
      if (!selectedStudent) return;
      const { error } = await supabase
        .from('student_month_credits')
        .upsert(
          {
            student_id: selectedStudent.id,
            month_ref: monthRef,
            monthly_limit: limitInput,
          },
          { onConflict: 'student_id,month_ref' }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Créditos atualizados');
      setSelectedStudent(null);
      queryClient.invalidateQueries({ queryKey: ['admin-credits'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const getCreditsForStudent = (studentId: string) => {
    return credits.find((c) => c.student_id === studentId);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="font-display text-xl uppercase tracking-wider">Alunos e Créditos</h1>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Label className="text-xs text-muted-foreground">Mês:</Label>
          <Input
            type="month"
            value={monthInput}
            onChange={(e) => setMonthInput(e.target.value)}
            className="w-full bg-card text-sm sm:w-40"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : (
        <div className="space-y-2">
          {students.map((s) => {
            const credit = getCreditsForStudent(s.id);
            return (
              <div key={s.id} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 animate-fade-in sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10">
                    {s.avatar_url ? (
                      <img
                        src={s.avatar_url}
                        alt={`Foto de ${s.full_name || 'aluno'}`}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Users className="h-4 w-4 text-primary" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium break-words">{s.full_name || 'Sem nome'}</p>
                    <p className="text-xs text-muted-foreground">
                      Limite: {credit?.monthly_limit || 0} aulas/mês
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="self-end sm:self-auto"
                  onClick={() => {
                    setSelectedStudent(s);
                    setLimitInput(credit?.monthly_limit || 0);
                  }}
                >
                  <Edit className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={!!selectedStudent} onOpenChange={() => setSelectedStudent(null)}>
        <DialogContent className="bg-card border-border sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display uppercase tracking-wider">
              Definir créditos
            </DialogTitle>
          </DialogHeader>
          {selectedStudent && (
            <div className="space-y-4">
              <p className="text-sm text-foreground">
                {selectedStudent.full_name} — {monthInput}
              </p>
              <div className="space-y-1">
                <Label>Limite mensal de aulas</Label>
                <Input
                  type="number"
                  value={limitInput}
                  onChange={(e) => setLimitInput(+e.target.value)}
                  min={0}
                  className="bg-background"
                />
              </div>
              <Button
                onClick={() => saveCreditMutation.mutate()}
                disabled={saveCreditMutation.isPending}
                className="w-full font-display uppercase"
              >
                {saveCreditMutation.isPending ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminStudentsPage;
