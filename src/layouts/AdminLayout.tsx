import { useEffect, useMemo, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Calendar,
  Clock,
  BookOpen,
  Users,
  CalendarPlus,
  BarChart3,
  WalletCards,
  UserCircle,
  LogOut,
  Receipt,
} from 'lucide-react';
import { toast } from 'sonner';
import Logo from '@/components/Logo';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import BottomNav from '@/components/BottomNav';
import { ADMIN_LAST_ROUTE_KEY, saveLastRoute } from '@/lib/session-state';
import { supabase } from '@/integrations/supabase/client';

const ADMIN_NAV_ITEMS_BASE = [
  { to: '/admin', icon: Calendar, label: 'Agenda', end: true },
  { to: '/admin/slots', icon: Clock, label: 'Horários' },
  { to: '/admin/bookings', icon: BookOpen, label: 'Aulas' },
  { to: '/admin/students', icon: Users, label: 'Alunos' },
  { to: '/admin/bulk-schedule', icon: CalendarPlus, label: 'Lote' },
  { to: '/admin/reports', icon: BarChart3, label: 'Relatórios' },
  { to: '/admin/plans', icon: WalletCards, label: 'Planos' },
  { to: '/admin/plan-orders', icon: Receipt, label: 'Compras' },
  { to: '/admin/profile', icon: UserCircle, label: 'Perfil' },
];

const AdminLayout = () => {
  const { signOut, user } = useAuth();
  const location = useLocation();
  const previousUnreadRef = useRef<number | null>(null);

  const { data: unreadPlanOrdersCount = 0 } = useQuery({
    queryKey: ['admin-plan-order-unread', user?.id],
    queryFn: async () => {
      if (!user) return 0;
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('type', 'plan_order_new')
        .eq('read', false);

      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!user,
    refetchInterval: 120000,
  });

  useEffect(() => {
    if (!user) return;
    const path = `${location.pathname}${location.search}${location.hash}`;
    saveLastRoute(ADMIN_LAST_ROUTE_KEY, path);
  }, [user, location.pathname, location.search, location.hash]);

  useEffect(() => {
    const previous = previousUnreadRef.current;
    if (previous !== null && unreadPlanOrdersCount > previous) {
      const delta = unreadPlanOrdersCount - previous;
      toast.info(delta === 1 ? 'Novo pedido de compra recebido.' : `${delta} novos pedidos de compra recebidos.`);
    }
    previousUnreadRef.current = unreadPlanOrdersCount;
  }, [unreadPlanOrdersCount]);

  const adminNavItems = useMemo(
    () =>
      ADMIN_NAV_ITEMS_BASE.map((item) =>
        item.to === '/admin/plan-orders' ? { ...item, badgeCount: unreadPlanOrdersCount } : item,
      ),
    [unreadPlanOrdersCount],
  );

  return (
    <div className="flex min-h-screen min-h-[100dvh] flex-col bg-background pb-20">
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-card/95 px-4 py-2.5 backdrop-blur-lg">
        <Logo size="sm" />
        <Button variant="ghost" size="sm" onClick={signOut} className="text-muted-foreground hover:text-destructive">
          <LogOut className="mr-2 h-4 w-4" />
          Sair
        </Button>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 p-3 md:p-6">
        <Outlet />
      </main>

      <BottomNav items={adminNavItems} />
    </div>
  );
};

export default AdminLayout;
