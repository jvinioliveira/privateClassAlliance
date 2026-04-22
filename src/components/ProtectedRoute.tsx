import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

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
      <Navigate
        to="/login"
        replace
        state={{
          reason: 'auth_required',
          redirectTo,
        }}
      />
    );
  }
  if (!requireAdmin && profile?.role === 'admin') return <Navigate to="/admin" replace />;
  if (requireAdmin && profile?.role !== 'admin') return <Navigate to="/dashboard" replace />;

  return <>{children}</>;
};

export default ProtectedRoute;
