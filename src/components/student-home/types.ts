export type BookingStatus = 'booked' | 'completed' | 'cancelled' | 'no_show';

export type StatusBadgeKind = 'agendada' | 'concluida' | 'presente' | 'faltou' | 'cancelada';

export interface NextClassSummary {
  id: string;
  dateLabel: string;
  timeLabel: string;
  classTypeLabel: 'Individual' | 'Dupla';
  statusLabel: string;
  canCancel: boolean;
}

export interface RecentClassSummary {
  id: string;
  dateLabel: string;
  timeLabel: string;
  classTypeLabel: 'Individual' | 'Dupla';
  status: StatusBadgeKind;
}

export interface CoachMessageSummary {
  title: string;
  content: string;
  createdAtLabel?: string;
}

export interface ProgressStats {
  totalCompleted: number;
  completedThisMonth: number;
  streakWeeks: number;
  recentFrequency: number;
  monthlyLimit: number;
}
