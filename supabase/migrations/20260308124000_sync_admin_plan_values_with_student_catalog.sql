-- Sync default lesson plan values to match student-facing catalog

WITH desired_plans AS (
  SELECT *
  FROM (
    VALUES
      ('individual', 1,  'Aula Avulsa',     'Ideal para experimentar uma aula particular ou treinar pontualmente.',                         10000, 10),
      ('individual', 4,  'Pacote 4 Aulas',  'Otimo para manter constancia e evoluir com treinos semanais.',                                38000, 20),
      ('individual', 8,  'Pacote 8 Aulas',  'Mais ritmo de treino e melhor custo por aula para acelerar sua evolucao.',                    72000, 30),
      ('individual', 12, 'Pacote 12 Aulas', 'Melhor custo-beneficio para quem quer levar o treino a serio.',                              100000, 40)
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
        'aula avulsa',
        'pacote 4 aulas',
        'pacote 8 aulas',
        'pacote 12 aulas'
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
        'aula avulsa',
        'pacote 4 aulas',
        'pacote 8 aulas',
        'pacote 12 aulas'
      )
    )
);
