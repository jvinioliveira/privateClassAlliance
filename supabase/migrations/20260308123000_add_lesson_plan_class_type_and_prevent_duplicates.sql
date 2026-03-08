-- Add lesson plan category (individual/double) and prevent duplicate catalog entries.

ALTER TABLE public.lesson_plans
ADD COLUMN IF NOT EXISTS class_type TEXT;

UPDATE public.lesson_plans
SET class_type = CASE
  WHEN lower(coalesce(name, '')) LIKE '%dupla%'
    OR lower(coalesce(description, '')) LIKE '%dupla%' THEN 'double'
  ELSE 'individual'
END
WHERE class_type IS NULL;

UPDATE public.lesson_plans
SET class_type = 'individual'
WHERE class_type NOT IN ('individual', 'double');

ALTER TABLE public.lesson_plans
ALTER COLUMN class_type SET DEFAULT 'individual';

ALTER TABLE public.lesson_plans
ALTER COLUMN class_type SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'lesson_plans_class_type_check'
      AND conrelid = 'public.lesson_plans'::regclass
  ) THEN
    ALTER TABLE public.lesson_plans
    ADD CONSTRAINT lesson_plans_class_type_check
    CHECK (class_type IN ('individual', 'double'));
  END IF;
END $$;

WITH ranked AS (
  SELECT
    id,
    first_value(id) OVER (
      PARTITION BY class_type, credits, price_cents
      ORDER BY sort_order ASC, created_at ASC, id ASC
    ) AS keep_id,
    row_number() OVER (
      PARTITION BY class_type, credits, price_cents
      ORDER BY sort_order ASC, created_at ASC, id ASC
    ) AS row_num
  FROM public.lesson_plans
),
duplicates AS (
  SELECT id AS duplicate_id, keep_id
  FROM ranked
  WHERE row_num > 1
)
UPDATE public.student_plan_selections sps
SET plan_id = d.keep_id
FROM duplicates d
WHERE sps.plan_id = d.duplicate_id;

WITH ranked AS (
  SELECT
    id,
    first_value(id) OVER (
      PARTITION BY class_type, credits, price_cents
      ORDER BY sort_order ASC, created_at ASC, id ASC
    ) AS keep_id,
    row_number() OVER (
      PARTITION BY class_type, credits, price_cents
      ORDER BY sort_order ASC, created_at ASC, id ASC
    ) AS row_num
  FROM public.lesson_plans
),
duplicates AS (
  SELECT id AS duplicate_id
  FROM ranked
  WHERE row_num > 1
)
DELETE FROM public.lesson_plans lp
USING duplicates d
WHERE lp.id = d.duplicate_id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'lesson_plans_unique_class_credits_price'
      AND conrelid = 'public.lesson_plans'::regclass
  ) THEN
    ALTER TABLE public.lesson_plans
    ADD CONSTRAINT lesson_plans_unique_class_credits_price
    UNIQUE (class_type, credits, price_cents);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_lesson_plans_class_type_active_sort
ON public.lesson_plans (class_type, is_active, sort_order, credits);
