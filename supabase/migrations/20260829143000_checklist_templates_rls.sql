-- Templates globais: garantir tabela + seed e leitura via RLS
-- (GRANT sozinho quebra em produção se o advisor ligar RLS sem policy).

CREATE TABLE IF NOT EXISTS public.checklist_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.checklist_templates IS
  'Templates globais de checklist (abertura/fechamento bar/cozinha).';

INSERT INTO public.checklist_templates (slug, title, description, sort_order, items)
VALUES
(
  'abertura-bar',
  'Abertura do bar',
  'Rotina de abertura para bar/restaurante.',
  1,
  '[
    {"title":"Conferir limpeza do balcão","item_type":"check","requires_evidence":false},
    {"title":"Temperatura da chopeira (°C)","item_type":"numeric","config":{"unit":"°C","critical":true},"requires_evidence":false},
    {"title":"Foto da frente da loja","item_type":"photo","requires_evidence":true},
    {"title":"Caixa inicial conferido","item_type":"check","requires_evidence":false},
    {"title":"Assinatura do responsável","item_type":"signature","requires_evidence":true}
  ]'::jsonb
),
(
  'fechamento-bar',
  'Fechamento do bar',
  'Rotina de fechamento operacional.',
  2,
  '[
    {"title":"Desligar equipamentos","item_type":"check"},
    {"title":"Lixo retirado","item_type":"photo","requires_evidence":true},
    {"title":"Temperatura da câmara","item_type":"numeric","config":{"unit":"°C","critical":true}},
    {"title":"Portas trancadas","item_type":"check"},
    {"title":"Observações do turno","item_type":"note"}
  ]'::jsonb
),
(
  'fechamento-cozinha',
  'Fechamento da cozinha',
  'Checklist de segurança alimentar ao fechar.',
  3,
  '[
    {"title":"Fogões e fritadeiras desligados","item_type":"check"},
    {"title":"Foto da área limpa","item_type":"photo","requires_evidence":true},
    {"title":"Temperaturas dos refrigeradores","item_type":"numeric","config":{"unit":"°C","critical":true}},
    {"title":"Itens críticos ok","item_type":"rating"}
  ]'::jsonb
)
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  items = EXCLUDED.items,
  sort_order = EXCLUDED.sort_order;

GRANT SELECT ON public.checklist_templates TO authenticated, anon;

ALTER TABLE public.checklist_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "checklist_templates_select" ON public.checklist_templates;
CREATE POLICY "checklist_templates_select"
  ON public.checklist_templates FOR SELECT
  TO authenticated, anon
  USING (true);
