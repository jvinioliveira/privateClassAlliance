import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { LogOut, Pencil, UserCircle } from 'lucide-react';

const formatPhoneBR = (input: string) => {
  const digits = input.replace(/\D/g, '').slice(0, 11);
  if (!digits) return '';
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
};

const splitFullName = (fullName: string) => {
  const normalized = fullName.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return { firstName: '', lastName: '' };
  }

  const [firstName, ...rest] = normalized.split(' ');
  return { firstName: firstName ?? '', lastName: rest.join(' ') };
};

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
};

const ProfilePage = () => {
  const { profile, signOut, user, updatePassword, refreshProfile } = useAuth();
  const [firstName, setFirstName] = useState(profile?.first_name || '');
  const [lastName, setLastName] = useState(profile?.last_name || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [isEditingPhone, setIsEditingPhone] = useState(!(profile?.phone || '').trim());
  const [avatarPreview, setAvatarPreview] = useState(profile?.avatar_url || '');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const previewUrlRef = useRef<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    const parsedName = splitFullName(profile?.full_name || '');
    setFirstName((profile?.first_name || parsedName.firstName).trim());
    setLastName((profile?.last_name || parsedName.lastName).trim());
    const initialPhone = profile?.phone || '';
    setPhone(formatPhoneBR(initialPhone));
    setIsEditingPhone(!initialPhone.trim());
    setAvatarPreview(profile?.avatar_url || '');
    setAvatarFile(null);
    setRemoveAvatar(false);
  }, [profile?.first_name, profile?.last_name, profile?.full_name, profile?.phone, profile?.avatar_url, profile?.id]);

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

  const handleAvatarFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Selecione um arquivo de imagem.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('A imagem deve ter no maximo 5MB.');
      return;
    }

    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
    }

    const objectUrl = URL.createObjectURL(file);
    previewUrlRef.current = objectUrl;
    setAvatarFile(file);
    setRemoveAvatar(false);
    setAvatarPreview(objectUrl);
  };

  const handleSaveProfile = async () => {
    if (!user) return;
    setSavingProfile(true);
    try {
      const normalizedFirstName = firstName.trim();
      const normalizedLastName = lastName.trim();
      const combinedFullName = `${normalizedFirstName} ${normalizedLastName}`.trim();
      let nextAvatarUrl = removeAvatar ? null : profile?.avatar_url || null;

      if (avatarFile) {
        const fileExtension = avatarFile.name.split('.').pop()?.toLowerCase() || 'jpg';
        const filePath = `${user.id}/avatar.${fileExtension}`;
        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(filePath, avatarFile, { upsert: true });

        if (uploadError) throw uploadError;

        const { data: publicFile } = supabase.storage.from('avatars').getPublicUrl(filePath);
        nextAvatarUrl = `${publicFile.publicUrl}?v=${Date.now()}`;
      }

      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: combinedFullName || null,
          first_name: normalizedFirstName || null,
          last_name: normalizedLastName || null,
          phone: phone.trim() || null,
          avatar_url: nextAvatarUrl,
        })
        .eq('id', user.id);

      if (error) throw error;
      await refreshProfile();
      setIsEditingPhone(!(phone.trim()));
      toast.success('Perfil atualizado');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Erro ao salvar perfil'));
    } finally {
      setSavingProfile(false);
    }
  };

  const displayName = `${(profile?.first_name || '').trim()} ${(profile?.last_name || '').trim()}`.trim()
    || (profile?.full_name || '').trim()
    || 'Aluno';

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
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Erro ao atualizar senha'));
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
          <div className="relative">
            <input
              ref={avatarInputRef}
              id="avatarFile"
              type="file"
              accept="image/*"
              onChange={handleAvatarFileChange}
              className="hidden"
            />
            <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full bg-primary/10">
              {avatarPreview ? (
                <img src={avatarPreview} alt="Foto de perfil" className="h-full w-full object-cover" />
              ) : (
                <UserCircle className="h-7 w-7 text-primary" />
              )}
            </div>
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              className="absolute -bottom-1 -right-1 inline-flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
              aria-label="Alterar foto de perfil"
              title="Alterar foto"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>
          <div>
            <p className="font-medium text-foreground">{displayName}</p>
            <p className="text-xs text-muted-foreground">{user?.email}</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="firstName">Nome</Label>
          <Input
            id="firstName"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="border-border bg-background"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName">Sobrenome</Label>
          <Input
            id="lastName"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="border-border bg-background"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="phone">Telefone</Label>
          {!isEditingPhone && phone.trim() ? (
            <div className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
              <span className="text-sm text-foreground">{phone}</span>
              <button
                type="button"
                onClick={() => setIsEditingPhone(true)}
                className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Editar
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <Input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(formatPhoneBR(e.target.value))}
                placeholder="(99) 99999-9999"
                className="border-border bg-background"
              />
              {(profile?.phone || '').trim() && (
                <button
                  type="button"
                  onClick={() => {
                    setPhone(formatPhoneBR(profile?.phone || ''));
                    setIsEditingPhone(false);
                  }}
                  className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  Cancelar edição
                </button>
              )}
            </div>
          )}
        </div>

        {avatarPreview && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (previewUrlRef.current) {
                URL.revokeObjectURL(previewUrlRef.current);
                previewUrlRef.current = null;
              }
              setAvatarFile(null);
              setAvatarPreview('');
              setRemoveAvatar(true);
            }}
            className="w-full"
          >
            Remover foto
          </Button>
        )}

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
