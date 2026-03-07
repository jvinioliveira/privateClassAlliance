import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Logo from '@/components/Logo';
import { toast } from 'sonner';

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
    <path
      fill="#EA4335"
      d="M12 10.2v3.9h5.5c-.2 1.3-1.5 3.9-5.5 3.9-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.5 14.6 2.6 12 2.6A9.4 9.4 0 1 0 12 21.4c5.4 0 9-3.8 9-9.1 0-.6-.1-1.1-.2-1.5z"
    />
    <path
      fill="#34A853"
      d="M3.7 7.4l3.2 2.3A5.9 5.9 0 0 1 12 6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.5 14.6 2.6 12 2.6c-3.6 0-6.7 2-8.3 4.8z"
    />
    <path
      fill="#4A90E2"
      d="M12 21.4c2.5 0 4.7-.8 6.3-2.3l-2.9-2.3c-.8.6-1.8 1-3.4 1-3.9 0-5.4-2.7-5.6-4l-3.2 2.5A9.4 9.4 0 0 0 12 21.4z"
    />
    <path
      fill="#FBBC05"
      d="M6.4 13.8a6.2 6.2 0 0 1 0-3.6L3.2 7.7a9.4 9.4 0 0 0 0 8.6z"
    />
  </svg>
);

const LoginPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { signIn, signInWithGoogle } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await signIn(email, password);
      navigate('/', { replace: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro ao entrar';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    try {
      await signInWithGoogle();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erro ao entrar com Google';
      toast.error(message);
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm animate-fade-in space-y-2">
        <div className="flex flex-col items-center gap-5 text-center">
          <Logo size="xl" className="w-full justify-center" showImageOnMobile stacked />
          <h1 className="font-display text-2xl uppercase tracking-widest text-foreground">
            Entrar
          </h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              required
              className="bg-card border-border"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Senha</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="********"
                required
                className="bg-card border-border pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <Button type="submit" className="w-full font-display uppercase tracking-wider" disabled={loading}>
            {loading ? 'Entrando...' : 'Entrar'}
          </Button>
          <div className="relative py-1">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">ou</span>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            className="w-full gap-2 font-display uppercase tracking-wider"
            onClick={handleGoogleSignIn}
            disabled={loading}
          >
            <GoogleIcon />
            Continuar com Google
          </Button>
        </form>

        <div className="flex flex-col items-center gap-2 text-sm">
          <Link to="/reset-password" className="text-muted-foreground hover:text-primary transition-colors">
            Esqueci minha senha
          </Link>
          <Link to="/signup" className="text-muted-foreground hover:text-primary transition-colors">
            Não tem conta? <span className="text-primary font-medium">Cadastre-se</span>
          </Link>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
