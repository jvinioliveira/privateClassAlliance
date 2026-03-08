import { supabase } from '@/integrations/supabase/client';

type PurchaseRowRaw = {
  id: string;
  student_id: string;
  plan_id: string;
  credits: number;
  remaining_credits: number | null;
  price_cents: number;
  status: string;
  selected_at: string;
  expires_at: string;
  lesson_plans: {
    name: string | null;
    class_type: string | null;
  } | null;
};

export type StudentCreditPurchase = {
  id: string;
  studentId: string;
  planId: string;
  credits: number;
  remainingCredits: number;
  priceCents: number;
  status: string;
  selectedAt: string;
  expiresAt: string;
  planName: string | null;
  classType: string | null;
};

export type StudentCreditSummary = {
  totalCredits: number;
  usedCredits: number;
  remainingCredits: number;
  nextExpirationAt: string | null;
};

const baseSelect =
  'id, student_id, plan_id, credits, remaining_credits, price_cents, status, selected_at, expires_at, lesson_plans(name, class_type)';

const normalizePurchase = (row: PurchaseRowRaw): StudentCreditPurchase => {
  const safeCredits = Math.max(Number(row.credits) || 0, 0);
  const remainingRaw = row.remaining_credits ?? safeCredits;
  const safeRemaining = Math.max(Number(remainingRaw) || 0, 0);

  return {
    id: row.id,
    studentId: row.student_id,
    planId: row.plan_id,
    credits: safeCredits,
    remainingCredits: safeRemaining,
    priceCents: Math.max(Number(row.price_cents) || 0, 0),
    status: row.status,
    selectedAt: row.selected_at,
    expiresAt: row.expires_at,
    planName: row.lesson_plans?.name ?? null,
    classType: row.lesson_plans?.class_type ?? null,
  };
};

export const buildStudentCreditSummary = (purchases: StudentCreditPurchase[]): StudentCreditSummary => {
  const latest = purchases[0];
  if (!latest) {
    return {
      totalCredits: 0,
      usedCredits: 0,
      remainingCredits: 0,
      nextExpirationAt: null,
    };
  }

  const nowMs = Date.now();
  const expiresAtMs = new Date(latest.expiresAt).getTime();
  const hasValidBalance = Number.isFinite(expiresAtMs) && expiresAtMs > nowMs;
  const remainingCredits = hasValidBalance ? latest.remainingCredits : 0;
  const usedCredits = 0;
  const totalCredits = remainingCredits;
  const nextExpirationAt = hasValidBalance && remainingCredits > 0 ? latest.expiresAt : null;

  return {
    totalCredits,
    usedCredits,
    remainingCredits,
    nextExpirationAt,
  };
};

export const fetchActiveStudentCreditPurchases = async (studentId: string): Promise<StudentCreditPurchase[]> => {
  const { data, error } = await supabase
    .from('student_plan_selections')
    .select(baseSelect)
    .eq('student_id', studentId)
    .eq('status', 'active')
    .order('selected_at', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(1);

  if (error) throw error;
  return ((data ?? []) as unknown as PurchaseRowRaw[]).map(normalizePurchase);
};

export const fetchStudentCreditSummary = async (studentId: string): Promise<StudentCreditSummary> => {
  const purchases = await fetchActiveStudentCreditPurchases(studentId);
  const base = buildStudentCreditSummary(purchases);
  const latest = purchases[0];
  if (!latest || base.remainingCredits <= 0) return base;

  const untypedSupabase = supabase as unknown as {
    from: (table: string) => {
      select: (
        columns: string,
        options: { count: 'exact'; head: true },
      ) => {
        eq: (column: string, value: string) => {
          is: (column: string, value: null) => {
            gte: (column: string, value: string) => Promise<{ count: number | null; error: Error | null }>;
          };
        };
      };
    };
  };

  const { count, error } = await untypedSupabase
    .from('student_credit_usages')
    .select('id', { count: 'exact', head: true })
    .eq('student_id', studentId)
    .is('restored_at', null)
    .gte('consumed_at', latest.selectedAt);

  if (error) throw error;

  const usedCredits = count ?? 0;
  const totalCredits = base.remainingCredits + usedCredits;

  return {
    totalCredits,
    usedCredits,
    remainingCredits: base.remainingCredits,
    nextExpirationAt: base.nextExpirationAt,
  };
};

export const fetchStudentCreditPurchaseHistory = async (
  studentId: string,
  limit = 80,
): Promise<StudentCreditPurchase[]> => {
  const { data, error } = await supabase
    .from('student_plan_selections')
    .select(baseSelect)
    .eq('student_id', studentId)
    .order('selected_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return ((data ?? []) as unknown as PurchaseRowRaw[]).map(normalizePurchase);
};
