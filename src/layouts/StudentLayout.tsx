import { Outlet } from 'react-router-dom';
import { Calendar, BookOpen, Bell, UserCircle } from 'lucide-react';
import BottomNav from '@/components/BottomNav';
import Logo from '@/components/Logo';
import { useAuth } from '@/contexts/AuthContext';

const studentNavItems = [
  { to: '/calendar', icon: Calendar, label: 'Agenda' },
  { to: '/my-bookings', icon: BookOpen, label: 'Aulas' },
  { to: '/notifications', icon: Bell, label: 'Avisos' },
  { to: '/profile', icon: UserCircle, label: 'Perfil' },
];

const StudentLayout = () => {
  const { profile } = useAuth();

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Top header - mobile */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-card/95 px-4 py-3 backdrop-blur-lg">
        <Logo size="sm" />
        <span className="text-xs text-muted-foreground font-medium">
          {profile?.full_name || 'Aluno'}
        </span>
      </header>

      <main className="mx-auto max-w-4xl">
        <Outlet />
      </main>

      <BottomNav items={studentNavItems} />
    </div>
  );
};

export default StudentLayout;
