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
  const safeRemaining = Math.max(Math.min(Number(remainingRaw) || 0, safeCredits), 0);

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
  const totalCredits = purchases.reduce((acc, item) => acc + item.credits, 0);
  const remainingCredits = purchases.reduce((acc, item) => acc + item.remainingCredits, 0);
  const usedCredits = Math.max(totalCredits - remainingCredits, 0);
  const nextExpiringWithBalance = purchases.find((item) => item.remainingCredits > 0);
  const nextExpirationAt = nextExpiringWithBalance?.expiresAt ?? null;

  return {
    totalCredits,
    usedCredits,
    remainingCredits,
    nextExpirationAt,
  };
};

export const fetchActiveStudentCreditPurchases = async (studentId: string): Promise<StudentCreditPurchase[]> => {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('student_plan_selections')
    .select(baseSelect)
    .eq('student_id', studentId)
    .eq('status', 'active')
    .gt('expires_at', nowIso)
    .order('expires_at', { ascending: true })
    .order('selected_at', { ascending: true });

  if (error) throw error;
  return ((data ?? []) as unknown as PurchaseRowRaw[]).map(normalizePurchase);
};

export const fetchStudentCreditSummary = async (studentId: string): Promise<StudentCreditSummary> => {
  const purchases = await fetchActiveStudentCreditPurchases(studentId);
  return buildStudentCreditSummary(purchases);
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
