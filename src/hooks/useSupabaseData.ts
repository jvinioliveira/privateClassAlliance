import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface AvailabilitySlot {
  id: string;
  start_time: string;
  end_time: string;
  capacity: number;
  status: 'available' | 'blocked';
  notes: string | null;
  created_by: string | null;
  created_at: string;
  booked_seats?: number;
}

export interface Booking {
  id: string;
  slot_id: string;
  student_id: string;
  status: 'booked' | 'cancelled' | 'completed' | 'no_show';
  seats_reserved: number;
  created_by_admin: boolean;
  attendance_status: 'pending' | 'present' | 'absent';
  checked_in_at: string | null;
  checked_in_by: string | null;
  created_at: string;
  updated_at: string;
  slot?: AvailabilitySlot;
  student?: { id: string; full_name: string | null };
}

export interface StudentMonthCredit {
  id: string;
  student_id: string;
  month_ref: string;
  monthly_limit: number;
  created_at: string;
  updated_at: string;
}

export interface WaitlistEntry {
  id: string;
  slot_id: string;
  student_id: string;
  status: 'waiting' | 'notified' | 'accepted' | 'expired' | 'cancelled';
  position: number;
  notified_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: string | null;
  title: string | null;
  message: string | null;
  read: boolean;
  created_at: string;
}

const getMonthBounds = (monthRef: string) => {
  const [year, month] = monthRef.split('-').map(Number);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;

  return {
    start: `${year}-${String(month).padStart(2, '0')}-01T00:00:00-03:00`,
    end: `${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00-03:00`,
  };
};

// Fetch slots for a date range
export const useSlots = (startDate: string, endDate: string) => {
  return useQuery({
    queryKey: ['slots', startDate, endDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('availability_slots')
        .select('*')
        .gte('start_time', startDate)
        .lte('start_time', endDate)
        .order('start_time');
      if (error) throw error;
      return data as AvailabilitySlot[];
    },
    enabled: !!startDate && !!endDate,
  });
};

// Fetch bookings for slots (with student info for admin)
export const useBookingsForSlots = (slotIds: string[]) => {
  return useQuery({
    queryKey: ['bookings-for-slots', slotIds],
    queryFn: async () => {
      if (!slotIds.length) return [];
      const { data, error } = await supabase
        .from('bookings')
        .select('*, profiles!bookings_student_id_fkey(id, full_name)')
        .in('slot_id', slotIds)
        .eq('status', 'booked');
      if (error) throw error;
      return (data || []).map((b: any) => ({
        ...b,
        student: b.profiles,
      })) as Booking[];
    },
    enabled: slotIds.length > 0,
  });
};

// My bookings
export const useMyBookings = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['my-bookings', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('bookings')
        .select('*, availability_slots(*)')
        .eq('student_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map((b: any) => ({
        ...b,
        slot: b.availability_slots,
      })) as Booking[];
    },
    enabled: !!user,
  });
};

// Monthly credits
export const useMyCredits = (monthRef: string) => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['my-credits', user?.id, monthRef],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from('student_month_credits')
        .select('*')
        .eq('student_id', user.id)
        .eq('month_ref', monthRef)
        .single();
      return data as StudentMonthCredit | null;
    },
    enabled: !!user && !!monthRef,
  });
};

// Count used credits this month
export const useUsedCredits = (monthRef: string) => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['used-credits', user?.id, monthRef],
    queryFn: async () => {
      if (!user) return 0;
      const { start, end } = getMonthBounds(monthRef);

      const { count, error } = await supabase
        .from('bookings')
        .select('id, availability_slots!inner(start_time)', { count: 'exact', head: true })
        .eq('student_id', user.id)
        .eq('status', 'booked')
        .gte('availability_slots.start_time', start)
        .lt('availability_slots.start_time', end);
      if (error) throw error;
      return count || 0;
    },
    enabled: !!user && !!monthRef,
  });
};

// Notifications
export const useNotifications = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['notifications', user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as Notification[];
    },
    enabled: !!user,
  });
};

// RPC calls
export const bookSlot = async (slotId: string, seatsReserved: number) => {
  const { data, error } = await supabase.rpc('book_slot', {
    p_slot_id: slotId,
    p_seats_reserved: seatsReserved,
  });
  if (error) throw error;
  return data;
};

export const cancelBooking = async (bookingId: string) => {
  const { data, error } = await supabase.rpc('cancel_booking', {
    p_booking_id: bookingId,
  });
  if (error) throw error;
  return data;
};

export const rescheduleBooking = async (bookingId: string, newSlotId: string) => {
  const { data, error } = await supabase.rpc('reschedule_booking', {
    p_booking_id: bookingId,
    p_new_slot_id: newSlotId,
  });
  if (error) throw error;
  return data;
};

export const joinWaitlist = async (slotId: string) => {
  const { data, error } = await supabase.rpc('waitlist_join', {
    p_slot_id: slotId,
  });
  if (error) throw error;
  return data;
};

export const acceptWaitlist = async (waitlistId: string) => {
  const { data, error } = await supabase.rpc('waitlist_accept', {
    p_waitlist_id: waitlistId,
  });
  if (error) throw error;
  return data;
};

export const adminBulkBook = async (
  studentId: string,
  slotIds: string[],
  seatsReservedDefault: number = 1
) => {
  const { data, error } = await supabase.rpc('admin_bulk_book', {
    p_student_id: studentId,
    p_slot_ids: slotIds,
    p_seats_reserved_default: seatsReservedDefault,
  });
  if (error) throw error;
  return data;
};

export const adminCheckIn = async (bookingId: string, attendanceStatus: string) => {
  const { data, error } = await supabase.rpc('admin_check_in', {
    p_booking_id: bookingId,
    p_attendance_status: attendanceStatus,
  });
  if (error) throw error;
  return data;
};

export const getMonthReport = async (monthRef: string) => {
  const { data, error } = await supabase.rpc('get_month_report', {
    p_month_ref: monthRef,
  });
  if (error) throw error;
  return data;
};

