import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { Users } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

type StudentProfile = Database['public']['Tables']['profiles']['Row'];
type StudentCredit = Database['public']['Tables']['student_month_credits']['Row'];
type FeedbackRow = Database['public']['Tables']['student_feedback_submissions']['Row'];
type FeedbackWithStudent = FeedbackRow & {
  profiles: Pick<Database['public']['Tables']['profiles']['Row'], 'full_name'> | null;
};

const categoryLabels: Record<string, string> = {
  complaint: 'Reclamação',
  compliment: 'Elogio',
  suggestion: 'Sugestão',
  other: 'Outro',
  bug: 'Bug do site',
};

const AdminStudentsPage = () => {
  const [monthInput, setMonthInput] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

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

  const creditsByStudent = useMemo(() => {
    const map = new Map<string, StudentCredit>();
    credits.forEach((credit) => map.set(credit.student_id, credit));
    return map;
  }, [credits]);

  const { data: feedbacks = [] } = useQuery<FeedbackWithStudent[]>({
    queryKey: ['admin-student-feedbacks'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('student_feedback_submissions')
        .select('*, profiles:student_id(full_name)')
        .order('created_at', { ascending: false })
        .limit(80);
      if (error) throw error;
      return (data ?? []) as unknown as FeedbackWithStudent[];
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="font-display text-xl uppercase tracking-wider">Alunos</h1>
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

      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">Saldos de créditos (somente leitura)</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          O crédito agora é concedido automaticamente pelo fluxo oficial de pagamento. Ajustes manuais foram removidos desta tela.
        </p>

        {isLoading ? (
          <div className="flex justify-center py-10">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {students.map((student) => {
              const credit = creditsByStudent.get(student.id);
              return (
                <div
                  key={student.id}
                  className="animate-fade-in flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10">
                      {student.avatar_url ? (
                        <img
                          src={student.avatar_url}
                          alt={`Foto de ${student.full_name || 'aluno'}`}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <Users className="h-4 w-4 text-primary" />
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-medium break-words text-foreground">{student.full_name || 'Sem nome'}</p>
                      <p className="text-xs text-muted-foreground">Limite mensal: {credit?.monthly_limit || 0} aulas/mês</p>
                    </div>
                  </div>
                  <Badge variant="outline">Leitura</Badge>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Sugestões, reclamações e bugs dos alunos</h2>
        {feedbacks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum feedback enviado ainda.</p>
        ) : (
          <div className="space-y-2">
            {feedbacks.map((feedback) => (
              <div key={feedback.id} className="rounded-lg border border-border bg-background/40 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{categoryLabels[feedback.category] || feedback.category}</Badge>
                  <Badge variant="secondary">{feedback.status}</Badge>
                  <span className="text-xs text-muted-foreground">{feedback.profiles?.full_name || 'Aluno'}</span>
                </div>
                {feedback.subject && <p className="mt-2 text-sm font-medium text-foreground">{feedback.subject}</p>}
                <p className="mt-1 text-sm text-muted-foreground">{feedback.message}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminStudentsPage;
