-- Sync default lesson plan values to match student-facing catalog

WITH desired_plans AS (
  SELECT *
  FROM (
    VALUES
      (1,  'Aula Avulsa',     'Ideal para experimentar uma aula particular ou treinar pontualmente.',                         10000, 10),
      (4,  'Pacote 4 Aulas',  'Ótimo para manter constância e evoluir com treinos semanais.',                                 38000, 20),
      (8,  'Pacote 8 Aulas',  'Mais ritmo de treino e melhor custo por aula para acelerar sua evolução.',                     72000, 30),
      (12, 'Pacote 12 Aulas', 'Melhor custo-benefício para quem quer levar o treino a sério.',                               100000, 40)
  ) AS t(credits, name, description, price_cents, sort_order)
),
updated AS (
  UPDATE public.lesson_plans lp
  SET
    name = dp.name,
    description = dp.description,
    price_cents = dp.price_cents,
    sort_order = dp.sort_order,
    is_active = true,
    updated_at = now()
  FROM desired_plans dp
  WHERE
    lp.credits = dp.credits
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
INSERT INTO public.lesson_plans (name, description, credits, price_cents, sort_order, is_active)
SELECT dp.name, dp.description, dp.credits, dp.price_cents, dp.sort_order, true
FROM desired_plans dp
WHERE NOT EXISTS (
  SELECT 1
  FROM public.lesson_plans lp
  WHERE lp.credits = dp.credits
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

