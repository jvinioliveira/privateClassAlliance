import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, type Variants } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { cancelBooking } from '@/hooks/useSupabaseData';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { fetchStudentCreditSummary, type StudentCreditSummary } from '@/lib/student-credits';
import {
  CoachMessageCard,
  MonthlyCreditsCard,
  NextClassCard,
  RecentClassesCard,
  ScheduleClassCTA,
  SmartReminderBanner,
  StudentProgressCard,
  WelcomeHeader,
} from '@/components/student-home';
import type {
  CoachMessageSummary,
  NextClassSummary,
  ProgressStats,
  RecentClassSummary,
  StatusBadgeKind,
} from '@/components/student-home/types';

type BookingRow = Database['public']['Tables']['bookings']['Row'];
type SlotRow = Database['public']['Tables']['availability_slots']['Row'];
type DirectMessageRow = Database['public']['Tables']['direct_messages']['Row'];
type BookingWithSlot = BookingRow & { slot: SlotRow | null };
type BookingWithSlotRelation = BookingRow & { availability_slots: SlotRow | null };

const pageVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      duration: 0.35,
      staggerChildren: 0.08,
      delayChildren: 0.06,
    },
  },
};

const sectionVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] },
  },
};

const getMonthRef = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
};

const formatDateLabel = (isoDate: string) => {
  const normalized = new Date(isoDate).toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    timeZone: 'America/Sao_Paulo',
  });

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const formatTimeLabel = (isoDate: string) => {
  return new Date(isoDate).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
};

const canCancelBooking = (slotStartTime: string) => {
  const diff = new Date(slotStartTime).getTime() - Date.now();
  return diff >= 24 * 60 * 60 * 1000;
};

const getDisplayName = (firstName: string | null, fullName: string | null) => {
  const preferred = (firstName || '').trim();
  if (preferred) return preferred;

  const fallback = (fullName || '').trim();
  if (!fallback) return 'Aluno';

  return fallback.split(' ')[0] || 'Aluno';
};

const mapRecentStatus = (booking: BookingWithSlot): StatusBadgeKind => {
  if (booking.status === 'cancelled') return 'cancelada';
  if (booking.status === 'no_show') return 'faltou';
  if (booking.status === 'completed' && booking.attendance_status === 'absent') return 'faltou';
  if (booking.status === 'completed' && booking.attendance_status === 'present') return 'presente';
  if (booking.status === 'completed') return 'concluida';
  return 'agendada';
};

const getWeekStartUtcMs = (date: Date) => {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = copy.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  copy.setUTCDate(copy.getUTCDate() + mondayOffset);
  copy.setUTCHours(0, 0, 0, 0);
  return copy.getTime();
};

const calculateStreakWeeks = (completedDates: Date[]) => {
  if (!completedDates.length) return 0;

  const uniqueWeeks = new Set(completedDates.map((date) => getWeekStartUtcMs(date)));
  const thisWeek = getWeekStartUtcMs(new Date());
  const previousWeek = thisWeek - 7 * 24 * 60 * 60 * 1000;

  const cursorStart = uniqueWeeks.has(thisWeek)
    ? thisWeek
    : uniqueWeeks.has(previousWeek)
    ? previousWeek
    : null;

  if (!cursorStart) return 0;

  let streak = 0;
  let cursor = cursorStart;
  while (uniqueWeeks.has(cursor)) {
    streak += 1;
    cursor -= 7 * 24 * 60 * 60 * 1000;
  }

  return streak;
};

const StudentHomePage = () => {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const monthRef = getMonthRef();
  const chatHistoryCutoffIso = useMemo(
    () => new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    [],
  );

  const bookingsQuery = useQuery<BookingWithSlot[]>({
    queryKey: ['student-home', 'bookings', user?.id],
    queryFn: async () => {
      if (!user) return [];

      const { data, error } = await supabase
        .from('bookings')
        .select('*, availability_slots(*)')
        .eq('student_id', user.id)
        .order('created_at', { ascending: false })
        .limit(90);

      if (error) throw error;

      const rows = (data ?? []) as BookingWithSlotRelation[];
      return rows.map((booking) => ({ ...booking, slot: booking.availability_slots }));
    },
    enabled: !!user,
  });

  const creditSummaryQuery = useQuery<StudentCreditSummary>({
    queryKey: ['student-home', 'credit-summary', user?.id],
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
    enabled: !!user,
  });

  const coachMessagesQuery = useQuery<DirectMessageRow[]>({
    queryKey: ['student-home', 'coach-messages', user?.id],
    queryFn: async () => {
      if (!user) return [];

      const { data, error } = await supabase
        .from('direct_messages')
        .select('*')
        .eq('recipient_id', user.id)
        .is('read_at', null)
        .gte('created_at', chatHistoryCutoffIso)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  const cancelMutation = useMutation({
    mutationFn: (bookingId: string) => cancelBooking(bookingId),
    onSuccess: (result) => {
      const warningMessage = result?.warning_message?.trim();
      toast.success(warningMessage ? `Aula cancelada. ${warningMessage}` : 'Aula cancelada com sucesso.');
      queryClient.invalidateQueries({ queryKey: ['student-home'] });
      queryClient.invalidateQueries({ queryKey: ['my-bookings'] });
      queryClient.invalidateQueries({ queryKey: ['student-home', 'credit-summary'] });
      queryClient.invalidateQueries({ queryKey: ['credit-summary'] });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Não foi possível cancelar esta aula.';
      toast.error(message);
    },
  });

  const bookings = useMemo(() => bookingsQuery.data ?? [], [bookingsQuery.data]);
  const monthlyLimit = creditSummaryQuery.data?.totalCredits ?? 0;
  const usedCredits = creditSummaryQuery.data?.usedCredits ?? 0;
  const remainingCredits = creditSummaryQuery.data?.remainingCredits ?? 0;
  const studentName = getDisplayName(profile?.first_name ?? null, profile?.full_name ?? null);

  const upcomingBookings = useMemo(() => {
    return bookings
      .filter((booking) => booking.status === 'booked' && booking.slot?.start_time)
      .filter((booking) => new Date(booking.slot!.start_time).getTime() > Date.now())
      .sort((a, b) => {
        const aDate = new Date(a.slot?.start_time || 0).getTime();
        const bDate = new Date(b.slot?.start_time || 0).getTime();
        return aDate - bDate;
      });
  }, [bookings]);

  const nextClass = useMemo<NextClassSummary | null>(() => {
    const booking = upcomingBookings[0];
    if (!booking?.slot?.start_time) return null;

    return {
      id: booking.id,
      dateLabel: formatDateLabel(booking.slot.start_time),
      timeLabel: formatTimeLabel(booking.slot.start_time),
      classTypeLabel: booking.seats_reserved === 2 ? 'Dupla' : 'Individual',
      statusLabel: 'Confirmada',
      canCancel: canCancelBooking(booking.slot.start_time),
    };
  }, [upcomingBookings]);

  const recentClasses = useMemo<RecentClassSummary[]>(() => {
    const nowMs = Date.now();
    return bookings
      .filter((booking) => booking.slot?.start_time)
      .filter((booking) => new Date(booking.slot!.start_time).getTime() <= nowMs)
      .sort((a, b) => {
        const aDate = new Date(a.slot?.start_time || a.created_at).getTime();
        const bDate = new Date(b.slot?.start_time || b.created_at).getTime();
        return bDate - aDate;
      })
      .slice(0, 5)
      .map((booking) => {
        const startTime = booking.slot?.start_time || booking.created_at;
        return {
          id: booking.id,
          dateLabel: formatDateLabel(startTime),
          timeLabel: formatTimeLabel(startTime),
          classTypeLabel: booking.seats_reserved === 2 ? 'Dupla' : 'Individual',
          status: mapRecentStatus(booking),
        };
      });
  }, [bookings]);

  const progressStats = useMemo<ProgressStats>(() => {
    const completed = bookings.filter((booking) => booking.status === 'completed');
    const completedDates = completed
      .map((booking) => booking.slot?.start_time || booking.created_at)
      .map((isoDate) => new Date(isoDate));

    const [year, month] = monthRef.split('-').map(Number);
    const completedThisMonth = completedDates.filter(
      (date) => date.getFullYear() === year && date.getMonth() + 1 === month,
    ).length;

    const nowMs = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const lookbackStartMs = nowMs - 28 * dayMs;
    const weeklySeries = [0, 0, 0, 0];

    completedDates.forEach((date) => {
      const time = date.getTime();
      if (time < lookbackStartMs || time > nowMs) return;
      const bucket = Math.min(3, Math.floor((time - lookbackStartMs) / (7 * dayMs)));
      weeklySeries[bucket] += 1;
    });

    const recentFrequency = weeklySeries.reduce((acc, value) => acc + value, 0);

    return {
      totalCompleted: completed.length,
      completedThisMonth,
      streakWeeks: calculateStreakWeeks(completedDates),
      recentFrequency,
      monthlyLimit,
      weeklySeries,
    };
  }, [bookings, monthRef, monthlyLimit]);

  const coachMessage = useMemo<CoachMessageSummary | null>(() => {
    const selected = (coachMessagesQuery.data ?? []).find((item) => (item.message || '').trim().length > 0);
    if (!selected?.message) return null;

    return {
      title: 'Mensagem do professor',
      content: selected.message,
      createdAtLabel: new Date(selected.created_at).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        timeZone: 'America/Sao_Paulo',
      }),
    };
  }, [coachMessagesQuery.data]);

  const subtitle = nextClass
    ? 'Veja sua próxima aula e agende com facilidade.'
    : remainingCredits > 0
    ? 'Acompanhe suas aulas e organize seu mês.'
    : 'Seu treino começa com uma boa organização.';

  const handleGoCalendar = () => navigate('/calendar');
  const handleSchedule = () => navigate('/calendar');
  const handleReminderAction = () => navigate(remainingCredits > 0 ? '/calendar' : '/plans');

  const handleReschedule = (bookingId: string) => {
    navigate('/calendar', { state: { rescheduleBookingId: bookingId } });
    toast.message('Escolha um novo horário para remarcar sua aula.');
  };

  return (
    <div className="px-4 pb-6 pt-5 sm:px-5">
      <motion.div
        initial="hidden"
        animate="show"
        variants={pageVariants}
        className="mx-auto w-full max-w-5xl space-y-4 sm:space-y-5"
      >
        <WelcomeHeader studentName={studentName} subtitle={subtitle} />

        <motion.div variants={sectionVariants}>
          <NextClassCard
            loading={bookingsQuery.isLoading}
            hasError={bookingsQuery.isError}
            nextClass={nextClass}
            isCancelling={cancelMutation.isPending}
            onSchedule={handleSchedule}
            onSeeCalendar={handleGoCalendar}
            onReschedule={handleReschedule}
            onCancel={(bookingId) => cancelMutation.mutate(bookingId)}
          />
        </motion.div>

        <motion.div variants={sectionVariants} className="grid gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <MonthlyCreditsCard
              loading={creditSummaryQuery.isLoading}
              hasError={creditSummaryQuery.isError}
              used={usedCredits}
              total={monthlyLimit}
            />
          </div>

          <div className="lg:col-span-2">
            <SmartReminderBanner
              loading={creditSummaryQuery.isLoading}
              hasError={creditSummaryQuery.isError}
              remainingCredits={remainingCredits}
              monthlyLimit={monthlyLimit}
              onPrimaryAction={handleReminderAction}
            />
          </div>
        </motion.div>

        <motion.div variants={sectionVariants}>
          <ScheduleClassCTA onSchedule={handleSchedule} />
        </motion.div>

        <motion.div variants={sectionVariants} className="grid gap-4 xl:grid-cols-5">
          <div className="xl:col-span-3">
            <RecentClassesCard
              loading={bookingsQuery.isLoading}
              hasError={bookingsQuery.isError}
              classes={recentClasses}
            />
          </div>

          <div className="xl:col-span-2">
            <StudentProgressCard
              loading={bookingsQuery.isLoading}
              hasError={bookingsQuery.isError}
              stats={progressStats}
            />
          </div>
        </motion.div>

        <motion.div variants={sectionVariants}>
          <CoachMessageCard
            loading={coachMessagesQuery.isLoading}
            hasError={coachMessagesQuery.isError}
            message={coachMessage}
            onOpenInbox={() => navigate('/notifications')}
          />
        </motion.div>
      </motion.div>
    </div>
  );
};

export default StudentHomePage;
