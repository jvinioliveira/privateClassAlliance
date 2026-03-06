import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { LogOut, UserCircle } from 'lucide-react';

const ProfilePage = () => {
  const { profile, signOut, user, updatePassword } = useAuth();
  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    setFullName(profile?.full_name || '');
    setPhone(profile?.phone || '');
    setAvatarUrl(profile?.avatar_url || '');
  }, [profile?.full_name, profile?.phone, profile?.avatar_url, profile?.id]);

  const handleSaveProfile = async () => {
    if (!user) return;
    setSavingProfile(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: fullName.trim() || null,
          phone: phone.trim() || null,
          avatar_url: avatarUrl.trim() || null,
        })
        .eq('id', user.id);

      if (error) throw error;
      toast.success('Perfil atualizado');
    } catch (err: any) {
      toast.error(err.message || 'Erro ao salvar perfil');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleUpdatePassword = async () => {
    if (newPassword.length < 6) {
      toast.error('Senha deve ter no minimo 6 caracteres');
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error('As senhas nao coincidem');
      return;
    }

    setSavingPassword(true);
    try {
      await updatePassword(newPassword);
      toast.success('Senha atualizada');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      toast.error(err.message || 'Erro ao atualizar senha');
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="space-y-6 p-4">
      <h1 className="font-display text-xl uppercase tracking-wider text-foreground">
        Meu Perfil
      </h1>

      <div className="animate-fade-in space-y-4 rounded-xl border border-border bg-card p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-primary/10">
            {avatarUrl ? (
              <img src={avatarUrl} alt="Foto de perfil" className="h-full w-full object-cover" />
            ) : (
              <UserCircle className="h-7 w-7 text-primary" />
            )}
          </div>
          <div>
            <p className="font-medium text-foreground">{profile?.full_name || 'Aluno'}</p>
            <p className="text-xs text-muted-foreground">{user?.email}</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="fullName">Nome completo</Label>
          <Input
            id="fullName"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="border-border bg-background"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="phone">Telefone</Label>
          <Input
            id="phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(11) 99999-9999"
            className="border-border bg-background"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="avatarUrl">Foto (URL opcional)</Label>
          <Input
            id="avatarUrl"
            type="url"
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
            placeholder="https://..."
            className="border-border bg-background"
          />
        </div>

        <Button
          onClick={handleSaveProfile}
          disabled={savingProfile}
          className="w-full font-display uppercase tracking-wider"
        >
          {savingProfile ? 'Salvando...' : 'Salvar perfil'}
        </Button>
      </div>

      <div className="space-y-4 rounded-xl border border-border bg-card p-6">
        <h2 className="font-display text-lg uppercase tracking-wider text-foreground">
          Redefinir senha
        </h2>

        <div className="space-y-2">
          <Label htmlFor="newPassword">Nova senha</Label>
          <Input
            id="newPassword"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Minimo 6 caracteres"
            minLength={6}
            className="border-border bg-background"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirmar nova senha</Label>
          <Input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Repita a senha"
            minLength={6}
            className="border-border bg-background"
          />
        </div>

        <Button
          onClick={handleUpdatePassword}
          disabled={savingPassword}
          className="w-full font-display uppercase tracking-wider"
        >
          {savingPassword ? 'Atualizando...' : 'Atualizar senha'}
        </Button>
      </div>

      <Button
        variant="outline"
        onClick={signOut}
        className="w-full border-destructive/30 font-display uppercase tracking-wider text-destructive hover:bg-destructive/10"
      >
        <LogOut className="mr-2 h-4 w-4" />
        Sair da conta
      </Button>
    </div>
  );
};

export default ProfilePage;
