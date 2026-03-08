-- Sync default double-class plan values so student cards show the expected prices/savings.

WITH desired_plans AS (
  SELECT *
  FROM (
    VALUES
      (
        'double',
        1,
        'Aula Dupla Avulsa',
        'Referencia de R$ 160 por aula em dupla.',
        16000,
        10
      ),
      (
        'double',
        4,
        'Pacote 4 Aulas em Dupla',
        'R$ 150 por aula em dupla. Economia de R$ 10 por aula (R$ 40 no pacote).',
        60000,
        20
      ),
      (
        'double',
        8,
        'Pacote 8 Aulas em Dupla',
        'R$ 140 por aula em dupla. Economia de R$ 20 por aula (R$ 160 no pacote).',
        112000,
        30
      ),
      (
        'double',
        12,
        'Pacote 12 Aulas em Dupla',
        'R$ 130 por aula em dupla. Economia de R$ 30 por aula (R$ 360 no pacote).',
        156000,
        40
      )
  ) AS t(class_type, credits, name, description, price_cents, sort_order)
),
updated AS (
  UPDATE public.lesson_plans lp
  SET
    class_type = dp.class_type,
    name = dp.name,
    description = dp.description,
    price_cents = dp.price_cents,
    sort_order = dp.sort_order,
    is_active = true,
    updated_at = now()
  FROM desired_plans dp
  WHERE
    lp.class_type = dp.class_type
    AND lp.credits = dp.credits
    AND (
      lp.sort_order = dp.sort_order
      OR lower(lp.name) IN (
        'aula dupla avulsa',
        'pacote 4 aulas em dupla',
        'pacote 8 aulas em dupla',
        'pacote 12 aulas em dupla'
      )
    )
  RETURNING lp.credits
)
INSERT INTO public.lesson_plans (class_type, name, description, credits, price_cents, sort_order, is_active)
SELECT dp.class_type, dp.name, dp.description, dp.credits, dp.price_cents, dp.sort_order, true
FROM desired_plans dp
WHERE NOT EXISTS (
  SELECT 1
  FROM public.lesson_plans lp
  WHERE lp.class_type = dp.class_type
    AND lp.credits = dp.credits
    AND (
      lp.sort_order = dp.sort_order
      OR lower(lp.name) IN (
        'aula dupla avulsa',
        'pacote 4 aulas em dupla',
        'pacote 8 aulas em dupla',
        'pacote 12 aulas em dupla'
      )
    )
);
