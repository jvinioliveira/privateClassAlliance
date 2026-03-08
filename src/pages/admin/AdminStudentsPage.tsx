import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Users, Edit, MessageSquare, Bell } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';

type StudentProfile = Database['public']['Tables']['profiles']['Row'];
type StudentCredit = Database['public']['Tables']['student_month_credits']['Row'];
type DirectMessageRow = Database['public']['Tables']['direct_messages']['Row'];
type DirectConversationRow = Database['public']['Tables']['direct_conversations']['Row'];
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
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [selectedStudent, setSelectedStudent] = useState<StudentProfile | null>(null);
  const [chatStudent, setChatStudent] = useState<StudentProfile | null>(null);
  const [chatDraft, setChatDraft] = useState('');
  const [showClosedHistory, setShowClosedHistory] = useState(false);
  const [monthInput, setMonthInput] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [limitInput, setLimitInput] = useState(0);
  const chatHistoryCutoffIso = useMemo(
    () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    [],
  );

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

  const { data: unreadMessages = [] } = useQuery<DirectMessageRow[]>({
    queryKey: ['admin-student-chat-unread', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('direct_messages')
        .select('*')
        .eq('recipient_id', user.id)
        .is('read_at', null)
        .gte('created_at', chatHistoryCutoffIso)
        .order('created_at', { ascending: false })
        .limit(400);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
    refetchInterval: 5000,
  });

  const unreadByStudent = useMemo(() => {
    const counts: Record<string, number> = {};
    unreadMessages.forEach((item) => {
      counts[item.sender_id] = (counts[item.sender_id] || 0) + 1;
    });
    return counts;
  }, [unreadMessages]);

  const { data: chatConversation } = useQuery<DirectConversationRow | null>({
    queryKey: ['admin-student-chat-conversation', user?.id, chatStudent?.id],
    queryFn: async () => {
      if (!user || !chatStudent) return null;
      const { data, error } = await supabase
        .from('direct_conversations')
        .select('*')
        .eq('student_id', chatStudent.id)
        .eq('admin_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as DirectConversationRow | null;
    },
    enabled: !!user && !!chatStudent,
    refetchInterval: chatStudent ? 5000 : false,
  });

  const { data: chatMessages = [] } = useQuery<DirectMessageRow[]>({
    queryKey: ['admin-student-chat-thread', user?.id, chatStudent?.id, chatConversation?.id, showClosedHistory],
    queryFn: async () => {
      if (!user || !chatStudent) return [];
      if (!showClosedHistory && !chatConversation?.id) return [];

      let query = supabase
        .from('direct_messages')
        .select('*')
        .gte('created_at', chatHistoryCutoffIso)
        .order('created_at', { ascending: true })
        .limit(300);

      if (showClosedHistory) {
        query = query.or(
          `and(sender_id.eq.${user.id},recipient_id.eq.${chatStudent.id}),and(sender_id.eq.${chatStudent.id},recipient_id.eq.${user.id})`,
        );
      } else {
        query = query.eq('conversation_id', chatConversation!.id);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user && !!chatStudent,
    refetchInterval: chatStudent ? 5000 : false,
  });

  const chatClosed = chatConversation?.status === 'closed';

  useEffect(() => {
    if (!chatStudent || !user) return;
    const unreadIds = chatMessages
      .filter((msg) => msg.sender_id === chatStudent.id && msg.recipient_id === user.id && !msg.read_at)
      .map((msg) => msg.id);

    if (!unreadIds.length) return;

    const markRead = async () => {
      const { error } = await supabase
        .from('direct_messages')
        .update({ read_at: new Date().toISOString() })
        .in('id', unreadIds);
      if (error) return;
      queryClient.invalidateQueries({ queryKey: ['admin-student-chat-unread'] });
      queryClient.invalidateQueries({ queryKey: ['admin-student-chat-thread'] });
    };

    markRead();
  }, [chatMessages, chatStudent, queryClient, user]);

  useEffect(() => {
    setShowClosedHistory(false);
  }, [chatStudent?.id]);

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
          { onConflict: 'student_id,month_ref' },
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

  const sendChatMutation = useMutation({
    mutationFn: async () => {
      if (!chatStudent) return null;
      const cleaned = chatDraft.trim();
      if (!cleaned) throw new Error('Digite uma mensagem');
      const { data, error } = await supabase.rpc('send_message_to_student', {
        p_student_id: chatStudent.id,
        p_message: cleaned,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      setChatDraft('');
      queryClient.invalidateQueries({ queryKey: ['admin-student-chat-thread'] });
      queryClient.invalidateQueries({ queryKey: ['admin-student-chat-unread'] });
      toast.success('Mensagem enviada para o aluno.');
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Erro ao enviar mensagem';
      toast.error(message);
    },
  });

  const setConversationStatusMutation = useMutation({
    mutationFn: async (status: 'open' | 'closed') => {
      if (!chatStudent) throw new Error('Aluno não encontrado');
      const { data, error } = await supabase.rpc('set_direct_conversation_status', {
        p_other_user_id: chatStudent.id,
        p_status: status,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_, status) => {
      if (status === 'open') {
        setShowClosedHistory(false);
      }
      queryClient.invalidateQueries({ queryKey: ['admin-student-chat-conversation'] });
      queryClient.invalidateQueries({ queryKey: ['admin-student-chat-thread'] });
      queryClient.invalidateQueries({ queryKey: ['admin-student-chat-unread'] });
      toast.success(status === 'closed' ? 'Chat encerrado.' : 'Nova conversa iniciada.');
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Erro ao atualizar conversa';
      toast.error(message);
    },
  });

  const getCreditsForStudent = (studentId: string) => {
    return credits.find((c) => c.student_id === studentId);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="font-display text-xl uppercase tracking-wider">Alunos e créditos</h1>
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
          {students.map((student) => {
            const credit = getCreditsForStudent(student.id);
            const unreadCount = unreadByStudent[student.id] ?? 0;
            return (
              <div
                key={student.id}
                className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 animate-fade-in sm:flex-row sm:items-center sm:justify-between"
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
                    <button
                      type="button"
                      onClick={() => setChatStudent(student)}
                      className="flex items-center gap-2 text-left text-sm font-medium break-words text-foreground hover:text-primary"
                    >
                      <span>{student.full_name || 'Sem nome'}</span>
                      {unreadCount > 0 && (
                        <Badge variant="destructive" className="h-5 px-2 text-[10px]">
                          <Bell className="mr-1 h-3 w-3" />
                          {unreadCount}
                        </Badge>
                      )}
                    </button>
                    <p className="text-xs text-muted-foreground">Limite: {credit?.monthly_limit || 0} aulas/mês</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 self-end sm:self-auto">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setChatStudent(student)}
                    title="Enviar mensagem"
                  >
                    <MessageSquare className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setSelectedStudent(student);
                      setLimitInput(credit?.monthly_limit || 0);
                    }}
                    title="Editar créditos"
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

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

      <Dialog open={!!selectedStudent} onOpenChange={() => setSelectedStudent(null)}>
        <DialogContent className="bg-card border-border sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display uppercase tracking-wider">Definir créditos</DialogTitle>
          </DialogHeader>
          {selectedStudent && (
            <div className="space-y-4">
              <p className="text-sm text-foreground">
                {selectedStudent.full_name} - {monthInput}
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

      <Dialog
        open={!!chatStudent}
        onOpenChange={(open) => {
          if (!open) {
            setChatStudent(null);
            setChatDraft('');
            setShowClosedHistory(false);
          }
        }}
      >
        <DialogContent className="bg-card border-border sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display uppercase tracking-wider">
              Mensagens - {chatStudent?.full_name || 'Aluno'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {chatClosed ? 'Conversa encerrada.' : 'Conversa ativa.'}
              </p>
              <div className="flex items-center gap-2">
                {chatClosed ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 min-w-[132px] px-2.5 text-xs"
                      onClick={() => setShowClosedHistory((prev) => !prev)}
                    >
                      {showClosedHistory ? 'Ocultar histórico' : 'Ver histórico'}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 min-w-[132px] px-2.5 text-xs"
                      onClick={() => setConversationStatusMutation.mutate('open')}
                      disabled={setConversationStatusMutation.isPending}
                    >
                      Iniciar nova conversa
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setConversationStatusMutation.mutate('closed')}
                    disabled={setConversationStatusMutation.isPending}
                  >
                    Encerrar chat
                  </Button>
                )}
              </div>
            </div>

            {chatClosed && !showClosedHistory ? (
              <div className="rounded-lg border border-border bg-background/40 p-4 text-sm text-muted-foreground">
                Chat encerrado. Use "Ver histórico" para consultar mensagens antigas ou "Iniciar nova conversa" para continuar.
              </div>
            ) : (
              <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-border/80 bg-background/40 p-3">
                {chatMessages.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nenhuma mensagem com este aluno ainda.</p>
                ) : (
                  chatMessages.map((message) => {
                    const isMine = message.sender_id === user?.id;
                    return (
                      <div key={message.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                            isMine
                              ? 'border border-primary/20 bg-primary/10 text-foreground'
                              : 'border border-border bg-card text-foreground'
                          }`}
                        >
                          <p>{message.message}</p>
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            {new Date(message.created_at).toLocaleDateString('pt-BR', {
                              day: '2-digit',
                              month: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                              timeZone: 'America/Sao_Paulo',
                            })}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            <Textarea
              value={chatDraft}
              onChange={(event) => setChatDraft(event.target.value)}
              placeholder="Digite a mensagem para o aluno"
              className="min-h-20 bg-background"
              maxLength={1000}
              disabled={chatClosed}
            />

            <Button
              type="button"
              onClick={() => sendChatMutation.mutate()}
              disabled={sendChatMutation.isPending || chatClosed}
              className="w-full"
            >
              {sendChatMutation.isPending ? 'Enviando...' : 'Enviar mensagem'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminStudentsPage;


