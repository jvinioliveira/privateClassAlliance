import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock,
  LogOut,
  MessageSquareWarning,
  Pencil,
  ReceiptText,
  Settings,
  UserCircle,
  WalletCards,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { cancelBooking } from '@/hooks/useSupabaseData';
import {
  fetchStudentCreditPurchaseHistory,
  fetchStudentCreditSummary,
  type StudentCreditPurchase,
  type StudentCreditSummary,
} from '@/lib/student-credits';
import { toast } from 'sonner';

type SlotRow = Database['public']['Tables']['availability_slots']['Row'];
type BookingRow = Database['public']['Tables']['bookings']['Row'];
type FeedbackRow = Database['public']['Tables']['student_feedback_submissions']['Row'];
type BookingWithSlot = BookingRow & { slot: SlotRow | null };

type ProfileSectionKey =
  | 'account'
  | 'bookings'
  | 'completed'
  | 'credits'
  | 'purchase_history'
  | 'feedback'
  | 'faq'
  | 'settings'
  | 'password';

type ProfileSection = {
  value: ProfileSectionKey;
  label: string;
  icon: LucideIcon;
  studentOnly?: boolean;
};

type ProfileSettings = {
  reminderEmail: boolean;
  reminderPush: boolean;
  weeklySummary: boolean;
};

const SETTINGS_STORAGE_KEY = 'alliance:profile-settings';

const defaultSettings: ProfileSettings = {
  reminderEmail: true,
  reminderPush: true,
  weeklySummary: false,
};

const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  booked: { label: 'Agendada', variant: 'default' },
  completed: { label: 'Concluída', variant: 'secondary' },
  cancelled: { label: 'Cancelada', variant: 'destructive' },
  no_show: { label: 'Falta', variant: 'outline' },
};

const profileSections: ProfileSection[] = [
  { value: 'account', label: 'Minha conta', icon: UserCircle },
  { value: 'bookings', label: 'Meus agendamentos', icon: CalendarClock, studentOnly: true },
  { value: 'completed', label: 'Aulas realizadas', icon: CheckCircle2, studentOnly: true },
  { value: 'purchase_history', label: 'Histórico de compras', icon: ReceiptText, studentOnly: true },
  { value: 'credits', label: 'Meus créditos', icon: WalletCards, studentOnly: true },
  { value: 'password', label: 'Redefinir senha', icon: Pencil },
  { value: 'feedback', label: 'Feedback e bugs', icon: MessageSquareWarning, studentOnly: true },
  { value: 'faq', label: 'Dúvidas frequentes', icon: AlertCircle },
  { value: 'settings', label: 'Configurações', icon: Settings },
];

const sectionTitle: Record<ProfileSectionKey, string> = {
  account: 'Minha conta',
  bookings: 'Meus agendamentos',
  completed: 'Aulas realizadas',
  credits: 'Meus créditos',
  purchase_history: 'Histórico de compras',
  feedback: 'Feedback e bugs',
  faq: 'Dúvidas frequentes',
  settings: 'Configurações',
  password: 'Redefinir senha',
};

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

const formatBookingDateTime = (isoDate: string) => {
  const date = new Date(isoDate);
  const day = date
    .toLocaleDateString('pt-BR', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      timeZone: 'America/Sao_Paulo',
    })
    .replace(/\./g, '');

  const hour = date.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });

  return `${day} as ${hour}`;
};

const ProfilePage = () => {
  const { profile, signOut, user, updatePassword, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const isStudent = profile?.role !== 'admin';

  const now = new Date();
  const monthRef = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  const [activeSection, setActiveSection] = useState<ProfileSectionKey | null>(null);
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

  const [settings, setSettings] = useState<ProfileSettings>(defaultSettings);

  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const { data: bookings = [], isLoading: loadingBookings } = useQuery({
    queryKey: ['my-bookings', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('bookings')
        .select('*, availability_slots(*)')
        .eq('student_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;

      return ((data || []) as Array<BookingRow & { availability_slots: SlotRow | null }>).map((booking) => ({
        ...booking,
        slot: booking.availability_slots,
      }));
    },
    enabled: !!user && isStudent,
  });

  const { data: creditSummary, isLoading: loadingCreditSummary } = useQuery<StudentCreditSummary>({
    queryKey: ['credit-summary', user?.id],
    queryFn: async () => {
      if (!user) {
        return {
          totalCredits: 0,
          usedCredits: 0,
          remainingCredits: 0,
          nextExpirationAt: null,
        };
      }
      return fetchStudentCreditSummary(user.id);
    },
    enabled: !!user && isStudent,
  });

  const { data: purchaseHistory = [], isLoading: loadingPurchaseHistory } = useQuery<StudentCreditPurchase[]>({
    queryKey: ['credit-purchase-history', user?.id],
    queryFn: async () => {
      if (!user) return [];
      return fetchStudentCreditPurchaseHistory(user.id);
    },
    enabled: !!user && isStudent,
  });

  const [feedbackCategory, setFeedbackCategory] = useState<
    'complaint' | 'compliment' | 'suggestion' | 'other' | 'bug'
  >(
    'suggestion',
  );
  const [feedbackSubject, setFeedbackSubject] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState('');

  const { data: feedbackHistory = [], isLoading: loadingFeedbackHistory } = useQuery<FeedbackRow[]>({
    queryKey: ['student-feedback-history', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('student_feedback_submissions')
        .select('*')
        .eq('student_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as FeedbackRow[];
    },
    enabled: !!user && isStudent,
  });

  const cancelMutation = useMutation({
    mutationFn: (bookingId: string) => cancelBooking(bookingId),
    onSuccess: (result) => {
      const warningMessage = result?.warning_message?.trim();
      toast.success(warningMessage ? `Agendamento cancelado. ${warningMessage}` : 'Agendamento cancelado');
      queryClient.invalidateQueries({ queryKey: ['my-bookings'] });
      queryClient.invalidateQueries({ queryKey: ['credit-summary'] });
      queryClient.invalidateQueries({ queryKey: ['student-home', 'credit-summary'] });
      queryClient.invalidateQueries({ queryKey: ['credit-purchase-history'] });
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, 'Erro ao cancelar agendamento'));
    },
  });

  const submitFeedbackMutation = useMutation({
    mutationFn: async () => {
      const cleanedMessage = feedbackMessage.trim();
      if (!cleanedMessage) {
        throw new Error('Digite a mensagem do feedback.');
      }

      const { data, error } = await supabase.rpc('submit_student_feedback', {
        p_category: feedbackCategory,
        p_subject: feedbackSubject.trim() || null,
        p_message: cleanedMessage,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      setFeedbackSubject('');
      setFeedbackMessage('');
      setFeedbackCategory('suggestion');
      toast.success('Feedback enviado com sucesso.');
      queryClient.invalidateQueries({ queryKey: ['student-feedback-history'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, 'Erro ao enviar feedback'));
    },
  });

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

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const rawSettings = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!rawSettings) return;

    try {
      const parsed = JSON.parse(rawSettings) as Partial<ProfileSettings>;
      setSettings({ ...defaultSettings, ...parsed });
    } catch {
      setSettings(defaultSettings);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const visibleSections = useMemo(
    () => profileSections.filter((section) => (isStudent ? true : !section.studentOnly)),
    [isStudent],
  );

  useEffect(() => {
    if (!activeSection) return;
    if (visibleSections.some((section) => section.value === activeSection)) return;
    setActiveSection(null);
  }, [activeSection, visibleSections]);

  const handleAvatarFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Selecione um arquivo de imagem.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('A imagem deve ter no máximo 5MB.');
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

  const handleUpdatePassword = async () => {
    if (newPassword.length < 6) {
      toast.error('A senha deve ter no mínimo 6 caracteres.');
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error('As senhas não coincidem.');
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

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Erro ao sair da conta'));
    } finally {
      setSigningOut(false);
    }
  };

  const displayName =
    `${(profile?.first_name || '').trim()} ${(profile?.last_name || '').trim()}`.trim() ||
    (profile?.full_name || '').trim() ||
    'Aluno';

  const upcomingBookings = useMemo(() => {
    return (bookings as BookingWithSlot[])
      .filter((booking) => booking.status === 'booked' && booking.slot?.start_time)
      .sort((a, b) => {
        const aDate = new Date(a.slot?.start_time || 0).getTime();
        const bDate = new Date(b.slot?.start_time || 0).getTime();
        return aDate - bDate;
      });
  }, [bookings]);

  const completedBookings = useMemo(() => {
    return (bookings as BookingWithSlot[])
      .filter((booking) => booking.status === 'completed' && booking.slot?.start_time)
      .sort((a, b) => {
        const aDate = new Date(a.slot?.start_time || 0).getTime();
        const bDate = new Date(b.slot?.start_time || 0).getTime();
        return bDate - aDate;
      });
  }, [bookings]);

  const completedThisMonth = useMemo(() => {
    const [year, month] = monthRef.split('-').map(Number);
    return completedBookings.filter((booking) => {
      const date = new Date(booking.slot?.start_time || booking.created_at);
      return date.getFullYear() === year && date.getMonth() + 1 === month;
    }).length;
  }, [completedBookings, monthRef]);

  const monthlyLimit = creditSummary?.totalCredits || 0;
  const usedCredits = creditSummary?.usedCredits || 0;
  const remainingCredits = creditSummary?.remainingCredits || 0;
  const usedPercentage = monthlyLimit > 0 ? Math.min((usedCredits / monthlyLimit) * 100, 100) : 0;
  const nextExpirationLabel = creditSummary?.nextExpirationAt
    ? new Date(creditSummary.nextExpirationAt).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'America/Sao_Paulo',
      })
    : null;

  const canCancel = (slotStartTime?: string) => {
    if (!slotStartTime) return false;
    const start = new Date(slotStartTime);
    const diff = start.getTime() - Date.now();
    return diff >= 24 * 60 * 60 * 1000;
  };

  const renderSection = () => {
    if (!activeSection) return null;

    if (activeSection === 'account') {
      return (
        <div className="space-y-4 rounded-xl border border-border bg-card p-5">
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

          <Button onClick={handleSaveProfile} disabled={savingProfile} className="w-full font-display uppercase tracking-wider">
            {savingProfile ? 'Salvando...' : 'Salvar perfil'}
          </Button>
        </div>
      );
    }

    if (activeSection === 'bookings' && isStudent) {
      return (
        <div className="space-y-3 rounded-xl border border-border bg-card p-5">
          {loadingBookings ? (
            <div className="flex items-center justify-center py-10">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : upcomingBookings.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-background/40 p-6 text-center text-sm text-muted-foreground">
              Você ainda não possui agendamentos ativos.
            </div>
          ) : (
            <div className="space-y-3">
              {upcomingBookings.map((booking) => {
                const status = statusMap[booking.status] || statusMap.booked;
                const slotStart = booking.slot?.start_time;
                const canCancelBooking = canCancel(slotStart || undefined);

                return (
                  <div key={booking.id} className="rounded-lg border border-border bg-background/50 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          <p className="text-sm font-medium text-foreground">
                            {slotStart ? formatBookingDateTime(slotStart) : 'Horário indisponível'}
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <Badge variant={status.variant}>{status.label}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {booking.seats_reserved === 2 ? 'Dupla' : 'Individual'}
                          </span>
                        </div>
                      </div>

                      {booking.status === 'booked' && canCancelBooking && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => cancelMutation.mutate(booking.id)}
                          disabled={cancelMutation.isPending}
                        >
                          Cancelar
                        </Button>
                      )}
                    </div>

                    {booking.status === 'booked' && !canCancelBooking && (
                      <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                        <AlertCircle className="h-3 w-3" />
                        Cancelamento indisponível (menos de 24h).
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    if (activeSection === 'completed' && isStudent) {
      return (
        <div className="space-y-4 rounded-xl border border-border bg-card p-5">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-border bg-background/40 p-3">
              <p className="text-xs text-muted-foreground">Total concluídas</p>
              <p className="mt-1 text-xl font-semibold text-foreground">{completedBookings.length}</p>
            </div>
            <div className="rounded-lg border border-border bg-background/40 p-3">
              <p className="text-xs text-muted-foreground">Concluídas no mês</p>
              <p className="mt-1 text-xl font-semibold text-primary">{completedThisMonth}</p>
            </div>
          </div>

          {loadingBookings ? (
            <div className="flex items-center justify-center py-10">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : completedBookings.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-background/40 p-6 text-center text-sm text-muted-foreground">
              Nenhuma aula concluída ainda.
            </div>
          ) : (
            <div className="space-y-2">
              {completedBookings.slice(0, 12).map((booking) => (
                <div key={booking.id} className="flex items-center justify-between rounded-lg border border-border bg-background/40 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {booking.slot?.start_time ? formatBookingDateTime(booking.slot.start_time) : 'Horário indisponível'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {booking.seats_reserved === 2 ? 'Aula em dupla' : 'Aula individual'}
                    </p>
                  </div>
                  <Badge variant="secondary">Concluída</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    if (activeSection === 'credits' && isStudent) {
      return (
        <div className="space-y-4 rounded-xl border border-border bg-card p-5">
          {loadingCreditSummary ? (
            <div className="flex items-center justify-center py-10">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-border bg-background/40 p-4">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">Créditos ativos</p>
                    <p className="mt-1 text-2xl font-semibold text-foreground">
                      <span className="text-primary">{usedCredits}</span>
                      <span className="text-muted-foreground">/{monthlyLimit}</span>
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Restantes</p>
                    <p className="text-xl font-semibold text-primary">{remainingCredits}</p>
                  </div>
                </div>

                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${usedPercentage}%` }} />
                </div>

                {nextExpirationLabel && remainingCredits > 0 && (
                  <p className="mt-3 text-xs text-muted-foreground">Próximo vencimento de créditos: {nextExpirationLabel}</p>
                )}
              </div>

              <Button variant="outline" className="w-full" onClick={() => navigate('/plans')}>
                Ir para planos
              </Button>
            </>
          )}
        </div>
      );
    }

    if (activeSection === 'purchase_history' && isStudent) {
      return (
        <div className="space-y-4 rounded-xl border border-border bg-card p-5">
          {loadingPurchaseHistory ? (
            <div className="flex items-center justify-center py-10">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : purchaseHistory.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-background/40 p-6 text-center text-sm text-muted-foreground">
              Você ainda não possui compras de créditos.
            </div>
          ) : (
            <div className="space-y-3">
              {purchaseHistory.map((purchase) => {
                const expiresAtMs = new Date(purchase.expiresAt).getTime();
                const isExpired = Number.isFinite(expiresAtMs) ? expiresAtMs <= Date.now() : false;
                const isDepleted = purchase.remainingCredits <= 0;
                const statusLabel = isExpired ? 'Expirado' : isDepleted ? 'Esgotado' : 'Ativo';
                const statusVariant: 'default' | 'secondary' | 'destructive' | 'outline' = isExpired
                  ? 'destructive'
                  : isDepleted
                  ? 'secondary'
                  : 'default';

                const selectedAtLabel = new Date(purchase.selectedAt).toLocaleDateString('pt-BR', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  timeZone: 'America/Sao_Paulo',
                });
                const expiresAtLabel = new Date(purchase.expiresAt).toLocaleDateString('pt-BR', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  timeZone: 'America/Sao_Paulo',
                });

                return (
                  <div key={purchase.id} className="rounded-lg border border-border bg-background/40 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-foreground">
                          {purchase.planName || 'Plano personalizado'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Compra em {selectedAtLabel} • Expira em {expiresAtLabel}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {purchase.remainingCredits}/{purchase.credits} créditos restantes
                        </p>
                      </div>
                      <Badge variant={statusVariant}>{statusLabel}</Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    if (activeSection === 'feedback' && isStudent) {
      return (
        <div className="space-y-4 rounded-xl border border-border bg-card p-5">
          <div className="space-y-2">
            <Label htmlFor="feedbackCategory">Tipo</Label>
            <select
              id="feedbackCategory"
              value={feedbackCategory}
              onChange={(event) =>
                setFeedbackCategory(
                  event.target.value as 'complaint' | 'compliment' | 'suggestion' | 'other' | 'bug',
                )
              }
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
            >
              <option value="suggestion">Sugestão</option>
              <option value="complaint">Reclamação</option>
              <option value="compliment">Elogio</option>
              <option value="other">Outro</option>
              <option value="bug">Relatar erro/bug no site</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="feedbackSubject">Assunto (opcional)</Label>
            <Input
              id="feedbackSubject"
              value={feedbackSubject}
              onChange={(event) => setFeedbackSubject(event.target.value)}
              className="border-border bg-background"
              maxLength={120}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="feedbackMessage">Mensagem</Label>
            <Textarea
              id="feedbackMessage"
              value={feedbackMessage}
              onChange={(event) => setFeedbackMessage(event.target.value)}
              className="min-h-32 border-border bg-background"
              placeholder="Descreva sua sugestão, elogio ou reclamação com detalhes. Se for relatar um erro, informe o que você estava fazendo, o que aconteceu e, se possível, o modelo do seu dispositivo e navegador."
              maxLength={2000}
            />
          </div>

          <Button
            onClick={() => submitFeedbackMutation.mutate()}
            disabled={submitFeedbackMutation.isPending}
            className="w-full font-display uppercase tracking-wider"
          >
            {submitFeedbackMutation.isPending ? 'Enviando...' : 'Enviar feedback'}
          </Button>

          <div className="space-y-2 pt-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Histórico recente</p>
            {loadingFeedbackHistory ? (
              <div className="flex items-center justify-center py-6">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : feedbackHistory.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-background/40 p-4 text-center text-sm text-muted-foreground">
                Nenhum feedback enviado ainda.
              </div>
            ) : (
              <div className="space-y-2">
                {feedbackHistory.map((item) => (
                  <div key={item.id} className="rounded-lg border border-border bg-background/40 p-3">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{item.category}</Badge>
                      <Badge variant="secondary">{item.status}</Badge>
                    </div>
                    {item.subject && <p className="mt-2 text-sm font-medium text-foreground">{item.subject}</p>}
                    <p className="mt-1 text-sm text-muted-foreground">{item.message}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }

    if (activeSection === 'faq') {
      return (
        <div className="rounded-xl border border-border bg-card p-5">
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="faq-1">
              <AccordionTrigger>Como faço para agendar uma aula?</AccordionTrigger>
              <AccordionContent>
                Acesse a aba Agenda, escolha um horário disponível e confirme o agendamento.
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="faq-2">
              <AccordionTrigger>Como funciona o cancelamento?</AccordionTrigger>
              <AccordionContent>
                O cancelamento é permitido com no mínimo 24 horas de antecedência.
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="faq-3">
              <AccordionTrigger>Onde vejo meus créditos?</AccordionTrigger>
              <AccordionContent>
                Na opção Meus créditos você acompanha seu saldo ativo, consumo e validade dos créditos.
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="faq-4">
              <AccordionTrigger>Como alterar meus dados de conta?</AccordionTrigger>
              <AccordionContent>
                Use a opção Minha conta para editar nome, telefone e foto do perfil.
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      );
    }

    if (activeSection === 'settings') {
      return (
        <div className="space-y-4 rounded-xl border border-border bg-card p-5">
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-border bg-background/40 p-3">
              <div className="pr-3">
                <p className="text-sm font-medium text-foreground">Lembretes por e-mail</p>
                <p className="text-xs text-muted-foreground">Receber lembrete de aula no e-mail cadastrado.</p>
              </div>
              <Switch
                checked={settings.reminderEmail}
                onCheckedChange={(checked) => setSettings((prev) => ({ ...prev, reminderEmail: checked }))}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border bg-background/40 p-3">
              <div className="pr-3">
                <p className="text-sm font-medium text-foreground">Lembretes no app</p>
                <p className="text-xs text-muted-foreground">Exibir avisos de aulas e mudanças de horário.</p>
              </div>
              <Switch
                checked={settings.reminderPush}
                onCheckedChange={(checked) => setSettings((prev) => ({ ...prev, reminderPush: checked }))}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border bg-background/40 p-3">
              <div className="pr-3">
                <p className="text-sm font-medium text-foreground">Resumo semanal</p>
                <p className="text-xs text-muted-foreground">Mostrar um resumo semanal no perfil.</p>
              </div>
              <Switch
                checked={settings.weeklySummary}
                onCheckedChange={(checked) => setSettings((prev) => ({ ...prev, weeklySummary: checked }))}
              />
            </div>
          </div>

          <Button
            variant="outline"
            onClick={handleSignOut}
            disabled={signingOut}
            className="w-full border-destructive/30 font-display uppercase tracking-wider text-destructive hover:bg-destructive/10"
          >
            <LogOut className="mr-2 h-4 w-4" />
            {signingOut ? 'Saindo...' : 'Sair da conta'}
          </Button>
        </div>
      );
    }

    if (activeSection === 'password') {
      return (
        <div className="space-y-4 rounded-xl border border-border bg-card p-5">
          <div className="space-y-2">
            <Label htmlFor="newPassword">Nova senha</Label>
            <Input
              id="newPassword"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Mínimo 6 caracteres"
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

          <Button onClick={handleUpdatePassword} disabled={savingPassword} className="w-full font-display uppercase tracking-wider">
            {savingPassword ? 'Atualizando...' : 'Atualizar senha'}
          </Button>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="space-y-5 p-4">
      <h1 className="font-display text-xl uppercase tracking-wider text-foreground">Perfil</h1>

      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
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
                aria-label="Alterar foto"
                title="Alterar foto"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="min-w-0">
              <p className="truncate font-medium text-foreground">{displayName}</p>
              <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
            </div>
          </div>

          <Badge variant="outline">{profile?.role === 'admin' ? 'Administrador' : 'Aluno'}</Badge>
        </div>

        {isStudent && (
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-border/70 bg-background/50 p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Agendamentos ativos</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{upcomingBookings.length}</p>
            </div>
            <div className="rounded-lg border border-border/70 bg-background/50 p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Créditos restantes</p>
              <p className="mt-1 text-lg font-semibold text-primary">{remainingCredits}</p>
            </div>
          </div>
        )}
      </div>

      {activeSection ? (
        <div className="space-y-3">
          <Button
            variant="ghost"
            onClick={() => setActiveSection(null)}
            className="w-fit px-2 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Voltar
          </Button>

          <h2 className="font-display text-lg uppercase tracking-wider text-foreground">{sectionTitle[activeSection]}</h2>
          {renderSection()}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card">
          {visibleSections.map((section) => (
            <button
              key={section.value}
              type="button"
              onClick={() => setActiveSection(section.value)}
              className="flex w-full items-center justify-between border-b border-border px-4 py-3 text-left last:border-b-0 hover:bg-background/40"
            >
              <span className="flex items-center gap-3">
                <section.icon className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">{section.label}</span>
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ProfilePage;
