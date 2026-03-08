import { useQuery } from '@tanstack/react-query';
import { Bell, Calendar, House, UserCircle, WalletCards } from 'lucide-react';
import { Outlet } from 'react-router-dom';
import { useEffect } from 'react';
import BottomNav from '@/components/BottomNav';
import Logo from '@/components/Logo';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

const StudentLayout = () => {
  const { profile, user } = useAuth();

  useEffect(() => {
    if (!user || profile?.role !== 'student') return;

    void supabase.rpc('notify_due_credit_expiry');
  }, [user, profile?.role]);

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ['notifications', 'unread-count', user?.id],
    queryFn: async () => {
      if (!user) return 0;
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('read', false);

      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!user,
    refetchInterval: 30000,
  });

  const studentNavItems = [
    { to: '/home', icon: House, label: 'Início' },
    { to: '/calendar', icon: Calendar, label: 'Agenda' },
    { to: '/plans', icon: WalletCards, label: 'Planos' },
    { to: '/notifications', icon: Bell, label: 'Avisos', badgeCount: unreadCount },
    { to: '/profile', icon: UserCircle, label: 'Perfil' },
  ];

  return (
    <div className="flex min-h-screen min-h-[100dvh] flex-col bg-background pb-20">
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-card/95 px-4 py-2.5 backdrop-blur-lg">
        <Logo size="sm" />
        <span className="text-xs font-medium text-muted-foreground">
          {profile?.first_name || profile?.full_name || 'Aluno'}
        </span>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1">
        <Outlet />
      </main>

      <BottomNav items={studentNavItems} />
    </div>
  );
};

export default StudentLayout;
