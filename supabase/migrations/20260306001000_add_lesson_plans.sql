-- ============================================
-- Lesson plans and student plan selections
-- ============================================

CREATE TABLE public.lesson_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  credits INT NOT NULL CHECK (credits > 0),
  price_cents INT NOT NULL CHECK (price_cents >= 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.lesson_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view active plans"
  ON public.lesson_plans FOR SELECT
  USING (is_active = true OR public.is_admin(auth.uid()));

CREATE POLICY "Admins can manage lesson plans"
  ON public.lesson_plans FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE TABLE public.student_plan_selections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES public.lesson_plans(id) ON DELETE RESTRICT,
  month_ref DATE NOT NULL,
  credits INT NOT NULL CHECK (credits > 0),
  price_cents INT NOT NULL CHECK (price_cents >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  selected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(student_id, month_ref)
);

CREATE INDEX idx_student_plan_selections_student_month
  ON public.student_plan_selections(student_id, month_ref);

ALTER TABLE public.student_plan_selections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students can view own plan selections"
  ON public.student_plan_selections FOR SELECT
  USING (auth.uid() = student_id);

CREATE POLICY "Admins can view all plan selections"
  ON public.student_plan_selections FOR SELECT
  USING (public.is_admin(auth.uid()));

CREATE TRIGGER update_lesson_plans_updated_at
  BEFORE UPDATE ON public.lesson_plans
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_student_plan_selections_updated_at
  BEFORE UPDATE ON public.student_plan_selections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RPC: select monthly plan and apply credits
CREATE OR REPLACE FUNCTION public.choose_plan(
  p_plan_id UUID,
  p_month_ref DATE DEFAULT public.get_month_ref(now())
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan public.lesson_plans%ROWTYPE;
  v_selection_id UUID;
  v_used INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuario nao autenticado';
  END IF;

  SELECT * INTO v_plan
  FROM public.lesson_plans
  WHERE id = p_plan_id
    AND is_active = true;

  IF v_plan IS NULL THEN
    RAISE EXCEPTION 'Plano nao encontrado ou inativo';
  END IF;

  SELECT COUNT(*) INTO v_used
  FROM public.bookings b
  JOIN public.availability_slots s ON s.id = b.slot_id
  WHERE b.student_id = auth.uid()
    AND b.status = 'booked'
    AND public.get_month_ref(s.start_time) = p_month_ref;

  IF v_used > v_plan.credits THEN
    RAISE EXCEPTION 'Plano escolhido possui menos creditos (%), ja usados no mes (%)', v_plan.credits, v_used;
  END IF;

  INSERT INTO public.student_month_credits (student_id, month_ref, monthly_limit)
  VALUES (auth.uid(), p_month_ref, v_plan.credits)
  ON CONFLICT (student_id, month_ref)
  DO UPDATE SET
    monthly_limit = EXCLUDED.monthly_limit,
    updated_at = now();

  INSERT INTO public.student_plan_selections (
    student_id,
    plan_id,
    month_ref,
    credits,
    price_cents,
    status
  )
  VALUES (
    auth.uid(),
    v_plan.id,
    p_month_ref,
    v_plan.credits,
    v_plan.price_cents,
    'active'
  )
  ON CONFLICT (student_id, month_ref)
  DO UPDATE SET
    plan_id = EXCLUDED.plan_id,
    credits = EXCLUDED.credits,
    price_cents = EXCLUDED.price_cents,
    status = 'active',
    selected_at = now(),
    updated_at = now()
  RETURNING id INTO v_selection_id;

  RETURN v_selection_id;
END;
$$;

-- Seed default plans only when table is empty
INSERT INTO public.lesson_plans (name, description, credits, price_cents, sort_order)
SELECT *
FROM (
  VALUES
    ('Aula avulsa', '1 aula individual sem pacote', 1, 10000, 10),
    ('Pacote 4 aulas', 'Desconto de 10% no valor por aula', 4, 36000, 20),
    ('Pacote 8 aulas', 'Desconto de 15% no valor por aula', 8, 68000, 30),
    ('Pacote 12 aulas', 'Desconto de 20% no valor por aula', 12, 96000, 40)
) AS seed(name, description, credits, price_cents, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.lesson_plans);
