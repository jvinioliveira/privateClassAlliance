import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Logo from '@/components/Logo';
import { toast } from 'sonner';
import { getFriendlyErrorMessage } from '@/lib/ui-feedback';

const PASSWORD_RECOVERY_FLAG = 'auth:password-recovery';

const ResetPasswordPage = () => {
  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const { resetPassword, updatePassword } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
  const queryParams = new URLSearchParams(location.search);
  const hasRecoveryType =
    hashParams.get('type') === 'recovery' || queryParams.get('type') === 'recovery';
  const hasRecoveryTokens =
    hashParams.has('access_token') ||
    hashParams.has('refresh_token') ||
    queryParams.has('token_hash');
  const recoveryFlagValue =
    typeof window !== 'undefined' ? sessionStorage.getItem(PASSWORD_RECOVERY_FLAG) : null;
  const recoveryFlagTime = recoveryFlagValue ? Number(recoveryFlagValue) : 0;
  const hasRecoveryFlag =
    Number.isFinite(recoveryFlagTime) &&
    recoveryFlagTime > 0 &&
    Date.now() - recoveryFlagTime < 15 * 60 * 1000;
  const isRecovery = hasRecoveryType || hasRecoveryTokens || hasRecoveryFlag;

  useEffect(() => {
    if (recoveryFlagValue && !hasRecoveryFlag && typeof window !== 'undefined') {
      sessionStorage.removeItem(PASSWORD_RECOVERY_FLAG);
    }
  }, [hasRecoveryFlag, recoveryFlagValue]);

  const handleSendReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await resetPassword(email);
      setEmailSent(true);
      toast.success('E-mail de recuperação enviado.');
    } catch (err: unknown) {
      toast.error(getFriendlyErrorMessage(err, 'Não foi possível enviar o e-mail de recuperação.'));
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast.error('A senha deve ter no mínimo 6 caracteres.');
      return;
    }

    setLoading(true);
    try {
      await updatePassword(newPassword);
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem(PASSWORD_RECOVERY_FLAG);
      }
      toast.success('Senha atualizada.');
      navigate('/login', { replace: true });
    } catch (err: unknown) {
      toast.error(getFriendlyErrorMessage(err, 'Não foi possível atualizar a senha.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm animate-fade-in space-y-8">
        <div className="flex flex-col items-center gap-5 text-center">
          <Logo size="xl" className="w-full justify-center" />
          <h1 className="font-display text-2xl uppercase tracking-widest text-foreground">
            {isRecovery ? 'Nova senha' : 'Recuperar senha'}
          </h1>
        </div>

        {isRecovery ? (
          <form onSubmit={handleUpdatePassword} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="newPassword">Nova senha</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                minLength={6}
                required
                className="bg-card border-border"
              />
            </div>
            <Button type="submit" className="w-full font-display uppercase tracking-wider" disabled={loading}>
              {loading ? 'Salvando...' : 'Salvar nova senha'}
            </Button>
          </form>
        ) : emailSent ? (
          <div className="space-y-4 text-center">
            <p className="text-muted-foreground">
              Enviamos um link de recuperação para <strong className="text-foreground">{email}</strong>
            </p>
            <Link to="/login">
              <Button variant="outline" className="w-full font-display uppercase tracking-wider">
                Voltar para login
              </Button>
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSendReset} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
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
            <Button type="submit" className="w-full font-display uppercase tracking-wider" disabled={loading}>
              {loading ? 'Enviando...' : 'Enviar link de recuperação'}
            </Button>
          </form>
        )}

        <div className="text-center text-sm">
          <Link to="/login" className="text-muted-foreground hover:text-primary transition-colors">
            Voltar para login
          </Link>
        </div>
      </div>
    </div>
  );
};

export default ResetPasswordPage;
