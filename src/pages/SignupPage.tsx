import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Logo from '@/components/Logo';
import { toast } from 'sonner';

const SignupPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const { signUp } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await signUp(email, password, fullName);
      setSuccess(true);
      toast.success('Conta criada! Verifique seu email para confirmar.');
    } catch (err: any) {
      toast.error(err.message || 'Erro ao cadastrar');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm animate-fade-in space-y-6 text-center">
          <Logo size="lg" className="justify-center" />
          <h1 className="font-display text-2xl uppercase tracking-widest text-primary">
            Verifique seu email
          </h1>
          <p className="text-muted-foreground">
            Enviamos um link de confirmação para <strong className="text-foreground">{email}</strong>
          </p>
          <Link to="/login">
            <Button variant="outline" className="w-full font-display uppercase tracking-wider">
              Voltar para login
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm animate-fade-in space-y-8">
        <div className="flex flex-col items-center gap-4">
          <Logo size="lg" />
          <h1 className="font-display text-2xl uppercase tracking-widest text-foreground">
            Cadastro
          </h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fullName">Nome completo</Label>
            <Input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Seu nome"
              required
              className="bg-card border-border"
            />
          </div>
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
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mínimo 6 caracteres"
              minLength={6}
              required
              className="bg-card border-border"
            />
          </div>

          <Button type="submit" className="w-full font-display uppercase tracking-wider" disabled={loading}>
            {loading ? 'Criando conta...' : 'Criar conta'}
          </Button>
        </form>

        <div className="text-center text-sm">
          <Link to="/login" className="text-muted-foreground hover:text-primary transition-colors">
            Já tem conta? <span className="text-primary font-medium">Entrar</span>
          </Link>
        </div>
      </div>
    </div>
  );
};

export default SignupPage;
