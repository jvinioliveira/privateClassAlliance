import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { useAuth } from '@/contexts/AuthContext';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';

type NotificationRow = Database['public']['Tables']['notifications']['Row'];

const NotificationsPage = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: notifications = [], isLoading: loadingNotifications } = useQuery<NotificationRow[]>({
    queryKey: ['notifications', user?.id, 'preview'],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('notifications').update({ read: true }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const notificationPreview = notifications.slice(0, 8);
  const hasMoreNotifications = notifications.length > 8;

  return (
    <div className="space-y-4 p-4">
      <h1 className="font-display text-xl uppercase tracking-wider text-foreground">Notificações</h1>

      <div className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Atualizações do sistema</h2>
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
            <p className="text-sm text-muted-foreground">Nenhuma notificação no momento.</p>
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
