import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Bell, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { useAuth } from '@/contexts/AuthContext';

type NotificationRow = Database['public']['Tables']['notifications']['Row'];

const PAGE_SIZE = 5;

const NotificationsHistoryPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ['notifications-history', user?.id, page],
    queryFn: async () => {
      if (!user) return { notifications: [] as NotificationRow[], count: 0 };
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { data: notifications, error, count } = await supabase
        .from('notifications')
        .select('*', { count: 'exact' })
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .range(from, to);
      if (error) throw error;
      return { notifications: notifications ?? [], count: count ?? 0 };
    },
    enabled: !!user,
  });

  const notifications = useMemo(() => data?.notifications ?? [], [data?.notifications]);
  const totalCount = data?.count ?? 0;
  const totalPages = Math.max(Math.ceil(totalCount / PAGE_SIZE), 1);
  const hasPagination = totalCount > PAGE_SIZE;
  const canGoPrev = page > 0;
  const canGoNext = page + 1 < totalPages;

  const unreadIds = useMemo(() => notifications.filter((item) => !item.read).map((item) => item.id), [notifications]);

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('notifications').update({ read: true }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-history'] });
    },
  });

  const markAllVisibleAsReadMutation = useMutation({
    mutationFn: async () => {
      if (!unreadIds.length) return;
      const { error } = await supabase.from('notifications').update({ read: true }).in('id', unreadIds);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-history'] });
    },
  });

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-xl uppercase tracking-wider text-foreground">Histórico de notificações</h1>
          <p className="text-xs text-muted-foreground">
            Mostrando página {page + 1} de {totalPages}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => navigate('/notifications')}>
          Voltar
        </Button>
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{totalCount} notificações no total</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => markAllVisibleAsReadMutation.mutate()}
            disabled={!unreadIds.length || markAllVisibleAsReadMutation.isPending}
          >
            Marcar todas como lida
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-6 text-center">
            <Bell className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Nenhuma notificação encontrada.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {notifications.map((notification) => (
              <button
                key={notification.id}
                type="button"
                onClick={() => {
                  if (!notification.read) {
                    markReadMutation.mutate(notification.id);
                  }
                }}
                className={`w-full rounded-xl border p-4 text-left transition-colors ${
                  notification.read ? 'border-border bg-card/50' : 'border-primary/30 bg-primary/5'
                }`}
              >
                <p className="text-sm font-medium text-foreground">{notification.title}</p>
                <p className="text-xs text-muted-foreground">{notification.message}</p>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {new Date(notification.created_at).toLocaleString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    timeZone: 'America/Sao_Paulo',
                  })}
                </p>
              </button>
            ))}
          </div>
        )}

        {hasPagination && (
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPage((prev) => prev - 1)}
              disabled={!canGoPrev}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Anterior
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPage((prev) => prev + 1)}
              disabled={!canGoNext}
            >
              Próxima
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default NotificationsHistoryPage;
