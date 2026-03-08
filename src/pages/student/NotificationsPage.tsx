import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { useAuth } from '@/contexts/AuthContext';
import { Bell, Send } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

type NotificationRow = Database['public']['Tables']['notifications']['Row'];
type DirectMessageRow = Database['public']['Tables']['direct_messages']['Row'];
type DirectConversationRow = Database['public']['Tables']['direct_conversations']['Row'];
type ProfileRow = Database['public']['Tables']['profiles']['Row'];

const NotificationsPage = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [draftMessage, setDraftMessage] = useState('');
  const [showClosedHistory, setShowClosedHistory] = useState(false);
  const chatHistoryCutoffIso = useMemo(
    () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    [],
  );

  const { data: admins = [] } = useQuery<Pick<ProfileRow, 'id' | 'full_name'>[]>({
    queryKey: ['chat-admin-list', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('role', 'admin')
        .order('full_name', { ascending: true })
        .limit(5);
      if (error) throw error;
      return (data ?? []) as Pick<ProfileRow, 'id' | 'full_name'>[];
    },
    enabled: !!user,
  });

  const primaryAdmin = admins[0] ?? null;

  const { data: conversation } = useQuery<DirectConversationRow | null>({
    queryKey: ['student-chat-conversation', user?.id, primaryAdmin?.id],
    queryFn: async () => {
      if (!user || !primaryAdmin) return null;
      const { data, error } = await supabase
        .from('direct_conversations')
        .select('*')
        .eq('student_id', user.id)
        .eq('admin_id', primaryAdmin.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as DirectConversationRow | null;
    },
    enabled: !!user && !!primaryAdmin,
  });

  const chatClosed = conversation?.status === 'closed';

  const { data: messages = [], isLoading: loadingMessages } = useQuery<DirectMessageRow[]>({
    queryKey: ['student-chat-messages', user?.id, primaryAdmin?.id, conversation?.id, showClosedHistory],
    queryFn: async () => {
      if (!user || !primaryAdmin) return [];
      if (!showClosedHistory && !conversation?.id) return [];

      let query = supabase
        .from('direct_messages')
        .select('*')
        .gte('created_at', chatHistoryCutoffIso)
        .order('created_at', { ascending: true })
        .limit(300);

      if (showClosedHistory) {
        query = query.or(
          `and(sender_id.eq.${user.id},recipient_id.eq.${primaryAdmin.id}),and(sender_id.eq.${primaryAdmin.id},recipient_id.eq.${user.id})`,
        );
      } else {
        query = query.eq('conversation_id', conversation!.id);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user && !!primaryAdmin,
    refetchInterval: 5000,
  });

  const { data: notifications = [], isLoading: loadingNotifications } = useQuery<NotificationRow[]>({
    queryKey: ['notifications', user?.id, 'preview'],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(6);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const unreadIncomingIds = useMemo(() => {
    if (!user) return [] as string[];
    return messages
      .filter((item) => item.recipient_id === user.id && !item.read_at)
      .map((item) => item.id);
  }, [messages, user]);

  useEffect(() => {
    if (!unreadIncomingIds.length) return;

    const markRead = async () => {
      const { error } = await supabase
        .from('direct_messages')
        .update({ read_at: new Date().toISOString() })
        .in('id', unreadIncomingIds);
      if (error) return;
      queryClient.invalidateQueries({ queryKey: ['student-chat-messages'] });
    };

    markRead();
  }, [queryClient, unreadIncomingIds]);

  const sendMessageMutation = useMutation({
    mutationFn: async (message: string) => {
      const { data, error } = await supabase.rpc('send_message_to_admins', {
        p_message: message,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      setDraftMessage('');
      queryClient.invalidateQueries({ queryKey: ['student-chat-messages'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      toast.success('Mensagem enviada para o professor.');
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Erro ao enviar mensagem';
      toast.error(message);
    },
  });

  const setConversationStatusMutation = useMutation({
    mutationFn: async (status: 'open' | 'closed') => {
      if (!primaryAdmin) throw new Error('Professor não encontrado');
      const { data, error } = await supabase.rpc('set_direct_conversation_status', {
        p_other_user_id: primaryAdmin.id,
        p_status: status,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_, status) => {
      if (status === 'open') {
        setShowClosedHistory(false);
      }
      queryClient.invalidateQueries({ queryKey: ['student-chat-conversation'] });
      queryClient.invalidateQueries({ queryKey: ['student-chat-messages'] });
      toast.success(status === 'closed' ? 'Chat encerrado.' : 'Nova conversa iniciada.');
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Erro ao atualizar conversa';
      toast.error(message);
    },
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const handleSend = () => {
    const cleaned = draftMessage.trim();
    if (!cleaned) {
      toast.error('Digite uma mensagem antes de enviar.');
      return;
    }
    sendMessageMutation.mutate(cleaned);
  };

  const notificationPreview = notifications.slice(0, 5);
  const hasMoreNotifications = notifications.length > 5;

  return (
    <div className="space-y-4 p-4">
      <h1 className="font-display text-xl uppercase tracking-wider text-foreground">Mensagens e Notificações</h1>

      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Chat com professor</h2>
            <span className="text-xs text-muted-foreground">{primaryAdmin?.full_name || 'Professor'}</span>
          </div>
          <div className="flex items-center gap-2">
            {chatClosed ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setShowClosedHistory((prev) => !prev)}
                >
                  {showClosedHistory ? 'Ocultar histórico' : 'Ver histórico'}
                </Button>
                <Button
                  type="button"
                  size="sm"
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
          <div className="max-h-80 space-y-2 overflow-y-auto rounded-lg border border-border/80 bg-background/40 p-3">
            {loadingMessages ? (
              <p className="text-xs text-muted-foreground">Carregando mensagens...</p>
            ) : messages.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nenhuma mensagem ainda. Envie a primeira mensagem para o professor.</p>
            ) : (
              messages.map((message) => {
                const isMine = user?.id === message.sender_id;
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

        <div className="flex gap-2">
          <Input
            value={draftMessage}
            onChange={(event) => setDraftMessage(event.target.value)}
            placeholder="Digite sua mensagem para o professor"
            className="bg-background"
            maxLength={1000}
            disabled={chatClosed}
          />
          <Button
            type="button"
            onClick={handleSend}
            disabled={sendMessageMutation.isPending || chatClosed}
            className="shrink-0"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Notificações do sistema</h2>
          {hasMoreNotifications && (
            <Button type="button" variant="outline" size="sm" onClick={() => navigate('/notifications/history')}>
              Ver todas
            </Button>
          )}
        </div>

        {loadingNotifications ? (
          <div className="flex items-center justify-center py-4">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : notificationPreview.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-6 text-center">
            <Bell className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Nenhuma notificacao</p>
          </div>
        ) : (
          <div className="space-y-2">
            {notificationPreview.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => {
                  if (!n.read) {
                    markReadMutation.mutate(n.id);
                  }
                }}
                className={`w-full rounded-xl border p-4 text-left transition-colors ${
                  n.read ? 'border-border bg-card/50' : 'border-primary/30 bg-primary/5'
                }`}
              >
                <p className="text-sm font-medium text-foreground">{n.title}</p>
                <p className="text-xs text-muted-foreground">{n.message}</p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default NotificationsPage;
