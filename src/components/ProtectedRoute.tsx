import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
}

const ProtectedRoute = ({ children, requireAdmin = false }: ProtectedRouteProps) => {
  const { user, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    const redirectTo = `${location.pathname}${location.search}${location.hash}`;
    return (
      <div className="flex min-h-[60dvh] items-center justify-center p-4">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-5">
          <h1 className="font-display text-lg uppercase tracking-wider">Acesso restrito</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Faça login para continuar.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button asChild className="w-full sm:w-auto">
              <Link
                to="/login"
                state={{
                  reason: 'auth_required',
                  redirectTo,
                }}
              >
                Fazer login
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link to="/dashboard">Voltar ao início</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }
  if (!requireAdmin && profile?.role === 'admin') return <Navigate to="/admin" replace />;
  if (requireAdmin && profile?.role !== 'admin') return <Navigate to="/dashboard" replace />;

  return <>{children}</>;
};

export default ProtectedRoute;
