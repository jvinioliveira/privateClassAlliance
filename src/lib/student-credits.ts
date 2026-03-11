import { supabase } from '@/integrations/supabase/client';

type PurchaseRowRaw = {
  id: string;
  student_id: string;
  plan_id: string | null;
  class_type: string | null;
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
  planId: string | null;
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
  'id, student_id, plan_id, class_type, credits, remaining_credits, price_cents, status, selected_at, expires_at, lesson_plans(name, class_type)';

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
    classType: row.class_type ?? row.lesson_plans?.class_type ?? null,
  };
};

const getLatestWallets = (purchases: StudentCreditPurchase[]) => {
  const latestByType = new Map<'individual' | 'double', StudentCreditPurchase>();

  for (const purchase of purchases) {
    const classType = purchase.classType === 'double' ? 'double' : 'individual';
    if (!latestByType.has(classType)) {
      latestByType.set(classType, purchase);
    }
  }

  return Array.from(latestByType.values());
};

export const buildStudentCreditSummary = (purchases: StudentCreditPurchase[]): StudentCreditSummary => {
  const latestWallets = getLatestWallets(purchases);
  if (!latestWallets.length) {
    return {
      totalCredits: 0,
      usedCredits: 0,
      remainingCredits: 0,
      nextExpirationAt: null,
    };
  }

  const nowMs = Date.now();
  const validWallets = latestWallets.filter((wallet) => {
    const expiresAtMs = new Date(wallet.expiresAt).getTime();
    return Number.isFinite(expiresAtMs) && expiresAtMs > nowMs && wallet.remainingCredits > 0;
  });

  const remainingCredits = validWallets.reduce((sum, wallet) => sum + wallet.remainingCredits, 0);
  const nextExpirationAt =
    validWallets.length > 0
      ? [...validWallets]
          .sort((a, b) => new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime())[0]
          .expiresAt
      : null;

  return {
    totalCredits: remainingCredits,
    usedCredits: 0,
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
    .limit(200);

  if (error) throw error;
  return ((data ?? []) as unknown as PurchaseRowRaw[]).map(normalizePurchase);
};

export const fetchStudentCreditSummary = async (studentId: string): Promise<StudentCreditSummary> => {
  const purchases = await fetchActiveStudentCreditPurchases(studentId);
  const base = buildStudentCreditSummary(purchases);
  const latestWallets = getLatestWallets(purchases);

  if (!latestWallets.length) return base;

  const selectionIds = latestWallets.map((wallet) => wallet.id);
  const untypedSupabase = supabase as unknown as {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (column: string, value: string) => {
          is: (column: string, value: null) => {
            in: (
              column: string,
              values: string[],
            ) => Promise<{ data: Array<{ selection_id: string | null }> | null; error: Error | null }>;
          };
        };
      };
    };
  };

  const { data, error } = await untypedSupabase
    .from('student_credit_usages')
    .select('selection_id')
    .eq('student_id', studentId)
    .is('restored_at', null)
    .in('selection_id', selectionIds);

  if (error) throw error;

  const usedCredits = (data ?? []).length;
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
