import { Outlet } from 'react-router-dom';
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
} from 'lucide-react';
import Logo from '@/components/Logo';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import BottomNav from '@/components/BottomNav';

const adminNavItems = [
  { to: '/admin', icon: Calendar, label: 'Agenda', end: true },
  { to: '/admin/slots', icon: Clock, label: 'Horários' },
  { to: '/admin/bookings', icon: BookOpen, label: 'Aulas' },
  { to: '/admin/students', icon: Users, label: 'Alunos' },
  { to: '/admin/bulk-schedule', icon: CalendarPlus, label: 'Lote' },
  { to: '/admin/reports', icon: BarChart3, label: 'Relatórios' },
  { to: '/admin/plans', icon: WalletCards, label: 'Planos' },
  { to: '/admin/profile', icon: UserCircle, label: 'Perfil' },
];

const AdminLayout = () => {
  const { signOut } = useAuth();

  return (
    <div className="flex min-h-screen min-h-[100dvh] flex-col bg-background pb-20">
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-card/95 px-4 py-2.5 backdrop-blur-lg">
        <Logo size="sm" />
        <Button
          variant="ghost"
          size="sm"
          onClick={signOut}
          className="text-muted-foreground hover:text-destructive"
        >
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

