import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Users, Edit } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const AdminStudentsPage = () => {
  const queryClient = useQueryClient();
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
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
      return data;
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
      return data;
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
    onError: (err: any) => toast.error(err.message),
  });

  const getCreditsForStudent = (studentId: string) => {
    return credits.find((c) => c.student_id === studentId);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-xl uppercase tracking-wider">Alunos & Créditos</h1>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Mês:</Label>
          <Input
            type="month"
            value={monthInput}
            onChange={(e) => setMonthInput(e.target.value)}
            className="w-40 bg-card text-sm"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : (
        <div className="space-y-2">
          {students.map((s: any) => {
            const credit = getCreditsForStudent(s.id);
            return (
              <div key={s.id} className="flex items-center justify-between rounded-xl border border-border bg-card p-4 animate-fade-in">
                <div className="flex items-center gap-3">
                  <Users className="h-4 w-4 text-primary" />
                  <div>
                    <p className="text-sm font-medium">{s.full_name || 'Sem nome'}</p>
                    <p className="text-xs text-muted-foreground">
                      Limite: {credit?.monthly_limit || 0} aulas/mês
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
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
