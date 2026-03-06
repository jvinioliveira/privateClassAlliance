import { Outlet } from 'react-router-dom';
import { Calendar, BookOpen, Bell, UserCircle, WalletCards } from 'lucide-react';
import BottomNav from '@/components/BottomNav';
import Logo from '@/components/Logo';
import { useAuth } from '@/contexts/AuthContext';

const studentNavItems = [
  { to: '/calendar', icon: Calendar, label: 'Agenda' },
  { to: '/my-bookings', icon: BookOpen, label: 'Aulas' },
  { to: '/plans', icon: WalletCards, label: 'Planos' },
  { to: '/notifications', icon: Bell, label: 'Avisos' },
  { to: '/profile', icon: UserCircle, label: 'Perfil' },
];

const StudentLayout = () => {
  const { profile } = useAuth();

  return (
    <div className="flex min-h-screen min-h-[100dvh] flex-col bg-background pb-20">
      {/* Top header - mobile */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-card/95 px-4 py-2.5 backdrop-blur-lg">
        <Logo size="sm" />
        <span className="text-xs text-muted-foreground font-medium">
          {profile?.full_name || 'Aluno'}
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

