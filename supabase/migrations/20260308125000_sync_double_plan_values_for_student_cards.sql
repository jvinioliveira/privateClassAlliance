-- Sync double-class plans using the same proportional discount logic of individual plans,
-- starting from the double single-lesson base of R$ 150.

WITH desired_plans AS (
  SELECT *
  FROM (
    VALUES
      (
        'double',
        1,
        'Aula Dupla Avulsa',
        'Ideal para experimentar o treino em dupla com ritmo forte desde a primeira aula.',
        15000,
        10
      ),
      (
        'double',
        4,
        'Pacote 4 Aulas em Dupla',
        'Ótimo para manter constância em dupla: R$ 142,50 por aula e economia progressiva para evoluir com parceiro.',
        57000,
        20
      ),
      (
        'double',
        8,
        'Pacote 8 Aulas em Dupla',
        'Mais volume de treino e melhor custo em dupla: R$ 135,00 por aula, com 10% de desconto sobre a avulsa.',
        108000,
        30
      ),
      (
        'double',
        12,
        'Pacote 12 Aulas em Dupla',
        'Maior desconto da categoria dupla: R$ 125,00 por aula e ganho máximo no custo-benefício para treinar em alto nível.',
        150000,
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
