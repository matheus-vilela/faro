-- Semeia todas as unidades padrão do sistema em cada empresa (catálogo fixo).
-- Unidade principal continua sendo uma por empresa (por padrão `un`).

CREATE OR REPLACE FUNCTION public.seed_default_company_unit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.company_units (company_id, code, label, sort_order, is_primary) VALUES
    (NEW.id, 'mg', 'Miligrama', 0, FALSE),
    (NEW.id, 'g', 'Grama', 1, FALSE),
    (NEW.id, 'kg', 'Quilograma', 2, FALSE),
    (NEW.id, 'ml', 'Mililitro', 3, FALSE),
    (NEW.id, 'l', 'Litro', 4, FALSE),
    (NEW.id, 'lata', 'Lata', 5, FALSE),
    (NEW.id, 'un', 'Unidade', 6, TRUE),
    (NEW.id, 'cx', 'Caixa', 7, FALSE),
    (NEW.id, 'pc', 'Peça', 8, FALSE),
    (NEW.id, 'garrafa', 'Garrafa', 9, FALSE),
    (NEW.id, 'frasco', 'Frasco', 10, FALSE),
    (NEW.id, 'galao', 'Galão', 11, FALSE),
    (NEW.id, 'pote', 'Pote', 12, FALSE),
    (NEW.id, 'rolo', 'Rolo', 13, FALSE),
    (NEW.id, 'pct', 'Pacote', 14, FALSE),
    (NEW.id, 'saco', 'Saco', 15, FALSE),
    (NEW.id, 'barrica', 'Barrica', 16, FALSE),
    (NEW.id, 'tambor', 'Tambor', 17, FALSE),
    (NEW.id, 'fardo', 'Fardo', 18, FALSE),
    (NEW.id, 'bisnaga', 'Bisnaga', 19, FALSE),
    (NEW.id, 'maco', 'Maço', 20, FALSE),
    (NEW.id, 'bandeja', 'Bandeja', 21, FALSE)
  ON CONFLICT (company_id, code) DO NOTHING;
  RETURN NEW;
END;
$$;

INSERT INTO public.company_units (company_id, code, label, sort_order, is_primary)
SELECT c.id, v.code, v.label, v.sort_order, v.is_primary
FROM public.companies c
CROSS JOIN (
  VALUES
    ('mg', 'Miligrama', 0, FALSE),
    ('g', 'Grama', 1, FALSE),
    ('kg', 'Quilograma', 2, FALSE),
    ('ml', 'Mililitro', 3, FALSE),
    ('l', 'Litro', 4, FALSE),
    ('lata', 'Lata', 5, FALSE),
    ('un', 'Unidade', 6, FALSE),
    ('cx', 'Caixa', 7, FALSE),
    ('pc', 'Peça', 8, FALSE),
    ('garrafa', 'Garrafa', 9, FALSE),
    ('frasco', 'Frasco', 10, FALSE),
    ('galao', 'Galão', 11, FALSE),
    ('pote', 'Pote', 12, FALSE),
    ('rolo', 'Rolo', 13, FALSE),
    ('pct', 'Pacote', 14, FALSE),
    ('saco', 'Saco', 15, FALSE),
    ('barrica', 'Barrica', 16, FALSE),
    ('tambor', 'Tambor', 17, FALSE),
    ('fardo', 'Fardo', 18, FALSE),
    ('bisnaga', 'Bisnaga', 19, FALSE),
    ('maco', 'Maço', 20, FALSE),
    ('bandeja', 'Bandeja', 21, FALSE)
) AS v(code, label, sort_order, is_primary)
ON CONFLICT (company_id, code) DO NOTHING;

-- Só promove `un` a principal onde a empresa ainda não tem nenhuma principal.
UPDATE public.company_units u
SET is_primary = TRUE
WHERE u.code = 'un'
  AND NOT EXISTS (
    SELECT 1
    FROM public.company_units x
    WHERE x.company_id = u.company_id
      AND x.is_primary
  );
