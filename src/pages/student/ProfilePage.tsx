import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { LogOut, UserCircle } from 'lucide-react';

const ProfilePage = () => {
  const { profile, signOut, user } = useAuth();
  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setFullName(profile?.full_name || '');
  }, [profile?.full_name, profile?.id]);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ full_name: fullName })
        .eq('id', user.id);
      if (error) throw error;
      toast.success('Perfil atualizado');
    } catch (err: any) {
      toast.error(err.message || 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 p-4">
      <h1 className="font-display text-xl uppercase tracking-wider text-foreground">
        Meu Perfil
      </h1>

      <div className="rounded-xl border border-border bg-card p-6 space-y-4 animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <UserCircle className="h-6 w-6 text-primary" />
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
            className="bg-background border-border"
          />
        </div>

        <Button onClick={handleSave} disabled={saving} className="w-full font-display uppercase tracking-wider">
          {saving ? 'Salvando...' : 'Salvar alterações'}
        </Button>
      </div>

      <Button
        variant="outline"
        onClick={signOut}
        className="w-full text-destructive border-destructive/30 hover:bg-destructive/10 font-display uppercase tracking-wider"
      >
        <LogOut className="mr-2 h-4 w-4" />
        Sair da conta
      </Button>
    </div>
  );
};

export default ProfilePage;
