-- Denormaliza company_id em tabelas filhas (multi-tenant) para RLS, índices e filtros diretos.
-- Excluídas: companies, profiles, master_* (catálogo global), company_groups (agrupador multi-unidade).

-- ---------------------------------------------------------------------------
-- expense_items
-- ---------------------------------------------------------------------------
ALTER TABLE public.expense_items
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

UPDATE public.expense_items ei
SET company_id = e.company_id
FROM public.expenses e
WHERE e.id = ei.expense_id
  AND ei.company_id IS DISTINCT FROM e.company_id;

DELETE FROM public.expense_items WHERE company_id IS NULL;

ALTER TABLE public.expense_items
  ALTER COLUMN company_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_expense_items_company
  ON public.expense_items(company_id);

-- ---------------------------------------------------------------------------
-- recebimentos + filhos
-- ---------------------------------------------------------------------------
ALTER TABLE public.recebimentos
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

UPDATE public.recebimentos r
SET company_id = e.company_id
FROM public.expenses e
WHERE e.id = r.expense_id
  AND r.company_id IS DISTINCT FROM e.company_id;

DELETE FROM public.recebimentos WHERE company_id IS NULL;

ALTER TABLE public.recebimentos
  ALTER COLUMN company_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_recebimentos_company
  ON public.recebimentos(company_id);

ALTER TABLE public.recebimento_item_status
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

UPDATE public.recebimento_item_status ris
SET company_id = e.company_id
FROM public.recebimentos r
JOIN public.expenses e ON e.id = r.expense_id
WHERE r.id = ris.recebimento_id
  AND ris.company_id IS DISTINCT FROM e.company_id;

DELETE FROM public.recebimento_item_status WHERE company_id IS NULL;

ALTER TABLE public.recebimento_item_status
  ALTER COLUMN company_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_recebimento_item_status_company
  ON public.recebimento_item_status(company_id);

ALTER TABLE public.recebimento_short_links
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

UPDATE public.recebimento_short_links l
SET company_id = e.company_id
FROM public.recebimentos r
JOIN public.expenses e ON e.id = r.expense_id
WHERE r.id = l.recebimento_id
  AND l.company_id IS DISTINCT FROM e.company_id;

DELETE FROM public.recebimento_short_links WHERE company_id IS NULL;

ALTER TABLE public.recebimento_short_links
  ALTER COLUMN company_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_recebimento_short_links_company
  ON public.recebimento_short_links(company_id);

-- ---------------------------------------------------------------------------
-- estoque
-- ---------------------------------------------------------------------------
ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

UPDATE public.stock_movements sm
SET company_id = p.company_id
FROM public.products p
WHERE p.id = sm.product_id
  AND sm.company_id IS DISTINCT FROM p.company_id;

DELETE FROM public.stock_movements WHERE company_id IS NULL;

ALTER TABLE public.stock_movements
  ALTER COLUMN company_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stock_movements_company
  ON public.stock_movements(company_id);

CREATE INDEX IF NOT EXISTS idx_stock_movements_company_product
  ON public.stock_movements(company_id, product_id);

-- ---------------------------------------------------------------------------
-- fornecedores (filhos)
-- ---------------------------------------------------------------------------
ALTER TABLE public.supplier_payment_info
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

UPDATE public.supplier_payment_info spi
SET company_id = s.company_id
FROM public.suppliers s
WHERE s.id = spi.supplier_id
  AND spi.company_id IS DISTINCT FROM s.company_id;

DELETE FROM public.supplier_payment_info WHERE company_id IS NULL;

ALTER TABLE public.supplier_payment_info
  ALTER COLUMN company_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_supplier_payment_info_company
  ON public.supplier_payment_info(company_id);

ALTER TABLE public.supplier_update_tokens
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

UPDATE public.supplier_update_tokens sut
SET company_id = s.company_id
FROM public.suppliers s
WHERE s.id = sut.supplier_id
  AND sut.company_id IS DISTINCT FROM s.company_id;

DELETE FROM public.supplier_update_tokens WHERE company_id IS NULL;

ALTER TABLE public.supplier_update_tokens
  ALTER COLUMN company_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_supplier_update_tokens_company
  ON public.supplier_update_tokens(company_id);

-- ---------------------------------------------------------------------------
-- receitas / compras / categorias de produto
-- ---------------------------------------------------------------------------
ALTER TABLE public.recipe_ingredients
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

UPDATE public.recipe_ingredients ri
SET company_id = r.company_id
FROM public.recipes r
WHERE r.id = ri.recipe_id
  AND ri.company_id IS DISTINCT FROM r.company_id;

DELETE FROM public.recipe_ingredients WHERE company_id IS NULL;

ALTER TABLE public.recipe_ingredients
  ALTER COLUMN company_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_company
  ON public.recipe_ingredients(company_id);

ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

UPDATE public.purchase_order_items poi
SET company_id = po.company_id
FROM public.purchase_orders po
WHERE po.id = poi.order_id
  AND poi.company_id IS DISTINCT FROM po.company_id;

DELETE FROM public.purchase_order_items WHERE company_id IS NULL;

ALTER TABLE public.purchase_order_items
  ALTER COLUMN company_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_order_items_company
  ON public.purchase_order_items(company_id);

ALTER TABLE public.product_category_assignments
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

UPDATE public.product_category_assignments pca
SET company_id = p.company_id
FROM public.products p
WHERE p.id = pca.product_id
  AND pca.company_id IS DISTINCT FROM p.company_id;

DELETE FROM public.product_category_assignments WHERE company_id IS NULL;

ALTER TABLE public.product_category_assignments
  ALTER COLUMN company_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_product_category_assignments_company
  ON public.product_category_assignments(company_id);

-- ---------------------------------------------------------------------------
-- inventário (listagens / links)
-- ---------------------------------------------------------------------------
ALTER TABLE public.inventory_count_listing_products
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

UPDATE public.inventory_count_listing_products iclp
SET company_id = l.company_id
FROM public.inventory_count_listings l
WHERE l.id = iclp.listing_id
  AND iclp.company_id IS DISTINCT FROM l.company_id;

DELETE FROM public.inventory_count_listing_products WHERE company_id IS NULL;

ALTER TABLE public.inventory_count_listing_products
  ALTER COLUMN company_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_count_listing_products_company
  ON public.inventory_count_listing_products(company_id);

ALTER TABLE public.inventory_count_short_links
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

UPDATE public.inventory_count_short_links sl
SET company_id = s.company_id
FROM public.inventory_count_sessions s
WHERE s.id = sl.session_id
  AND sl.company_id IS DISTINCT FROM s.company_id;

DELETE FROM public.inventory_count_short_links WHERE company_id IS NULL;

ALTER TABLE public.inventory_count_short_links
  ALTER COLUMN company_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_count_short_links_company
  ON public.inventory_count_short_links(company_id);

-- ---------------------------------------------------------------------------
-- import (receitas IA / jobs legados) — só se a tabela ainda existir
-- (removidas em 20260517180000 e 20260517120000 em ambientes atualizados)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.import_recipe_draft_components') IS NOT NULL
     AND to_regclass('public.import_recipe_drafts') IS NOT NULL THEN
    ALTER TABLE public.import_recipe_draft_components
      ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

    UPDATE public.import_recipe_draft_components c
    SET company_id = d.company_id
    FROM public.import_recipe_drafts d
    WHERE d.id = c.draft_id
      AND c.company_id IS DISTINCT FROM d.company_id;

    DELETE FROM public.import_recipe_draft_components WHERE company_id IS NULL;

    ALTER TABLE public.import_recipe_draft_components
      ALTER COLUMN company_id SET NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_import_recipe_draft_components_company
      ON public.import_recipe_draft_components(company_id);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.import_job_timeline') IS NOT NULL
     AND to_regclass('public.import_job_batches') IS NOT NULL THEN
    ALTER TABLE public.import_job_timeline
      ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

    UPDATE public.import_job_timeline t
    SET company_id = b.company_id
    FROM public.import_job_batches b
    WHERE b.id = t.batch_id
      AND t.company_id IS DISTINCT FROM b.company_id;

    DELETE FROM public.import_job_timeline WHERE company_id IS NULL;

    ALTER TABLE public.import_job_timeline
      ALTER COLUMN company_id SET NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_import_job_timeline_company
      ON public.import_job_timeline(company_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- onboarding (cluster members)
-- ---------------------------------------------------------------------------
ALTER TABLE public.onboarding_product_cluster_member
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

UPDATE public.onboarding_product_cluster_member m
SET company_id = c.company_id
FROM public.onboarding_product_cluster c
WHERE c.id = m.cluster_id
  AND m.company_id IS DISTINCT FROM c.company_id;

DELETE FROM public.onboarding_product_cluster_member WHERE company_id IS NULL;

ALTER TABLE public.onboarding_product_cluster_member
  ALTER COLUMN company_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_onboarding_product_cluster_member_company
  ON public.onboarding_product_cluster_member(company_id);

-- ---------------------------------------------------------------------------
-- checklists
-- ---------------------------------------------------------------------------
ALTER TABLE public.checklist_items
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

UPDATE public.checklist_items ci
SET company_id = c.company_id
FROM public.checklists c
WHERE c.id = ci.checklist_id
  AND ci.company_id IS DISTINCT FROM c.company_id;

DELETE FROM public.checklist_items WHERE company_id IS NULL;

ALTER TABLE public.checklist_items
  ALTER COLUMN company_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_checklist_items_company
  ON public.checklist_items(company_id);

ALTER TABLE public.checklist_assignments
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

UPDATE public.checklist_assignments ca
SET company_id = c.company_id
FROM public.checklists c
WHERE c.id = ca.checklist_id
  AND ca.company_id IS DISTINCT FROM c.company_id;

DELETE FROM public.checklist_assignments WHERE company_id IS NULL;

ALTER TABLE public.checklist_assignments
  ALTER COLUMN company_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_checklist_assignments_company
  ON public.checklist_assignments(company_id);

ALTER TABLE public.checklist_runs
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

UPDATE public.checklist_runs cr
SET company_id = c.company_id
FROM public.checklists c
WHERE c.id = cr.checklist_id
  AND cr.company_id IS DISTINCT FROM c.company_id;

DELETE FROM public.checklist_runs WHERE company_id IS NULL;

ALTER TABLE public.checklist_runs
  ALTER COLUMN company_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_checklist_runs_company
  ON public.checklist_runs(company_id);

ALTER TABLE public.checklist_run_items
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

UPDATE public.checklist_run_items cri
SET company_id = c.company_id
FROM public.checklist_runs cr
JOIN public.checklists c ON c.id = cr.checklist_id
WHERE cr.id = cri.run_id
  AND cri.company_id IS DISTINCT FROM c.company_id;

DELETE FROM public.checklist_run_items WHERE company_id IS NULL;

ALTER TABLE public.checklist_run_items
  ALTER COLUMN company_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_checklist_run_items_company
  ON public.checklist_run_items(company_id);

ALTER TABLE public.checklist_run_short_links
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

UPDATE public.checklist_run_short_links l
SET company_id = c.company_id
FROM public.checklist_runs cr
JOIN public.checklists c ON c.id = cr.checklist_id
WHERE cr.id = l.run_id
  AND l.company_id IS DISTINCT FROM c.company_id;

DELETE FROM public.checklist_run_short_links WHERE company_id IS NULL;

ALTER TABLE public.checklist_run_short_links
  ALTER COLUMN company_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_checklist_run_short_links_company
  ON public.checklist_run_short_links(company_id);

-- ---------------------------------------------------------------------------
-- whatsapp (short links)
-- ---------------------------------------------------------------------------
ALTER TABLE public.whatsapp_expense_draft_short_links
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

UPDATE public.whatsapp_expense_draft_short_links l
SET company_id = d.company_id
FROM public.whatsapp_expense_drafts d
WHERE d.id = l.draft_id
  AND l.company_id IS DISTINCT FROM d.company_id;

DELETE FROM public.whatsapp_expense_draft_short_links WHERE company_id IS NULL;

ALTER TABLE public.whatsapp_expense_draft_short_links
  ALTER COLUMN company_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_expense_draft_short_links_company
  ON public.whatsapp_expense_draft_short_links(company_id);

-- ---------------------------------------------------------------------------
-- adjust_product_stock: grava company_id nas movimentações
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adjust_product_stock(
  p_product_id UUID,
  p_delta DECIMAL,
  p_type TEXT,
  p_reference_type TEXT DEFAULT NULL,
  p_reference_id UUID DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
BEGIN
  SELECT company_id INTO v_company_id
  FROM public.products
  WHERE id = p_product_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'product not found: %', p_product_id;
  END IF;

  UPDATE public.products
  SET
    current_quantity = GREATEST(0, current_quantity + p_delta),
    updated_at = NOW()
  WHERE id = p_product_id;

  INSERT INTO public.stock_movements (
    product_id,
    company_id,
    quantity,
    type,
    reference_type,
    reference_id
  )
  VALUES (
    p_product_id,
    v_company_id,
    ABS(p_delta),
    CASE WHEN p_delta >= 0 THEN 'in' ELSE 'out' END,
    p_reference_type,
    p_reference_id
  );
END;
$$;

COMMENT ON COLUMN public.expense_items.company_id IS
  'Denormalizado de expenses.company_id para RLS e filtros por unidade.';
COMMENT ON COLUMN public.stock_movements.company_id IS
  'Denormalizado de products.company_id.';

-- ---------------------------------------------------------------------------
-- Triggers: preenchem company_id em INSERT/UPDATE quando o cliente não envia
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_fill_company_id_from_expense_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.company_id IS NULL AND NEW.expense_id IS NOT NULL THEN
    SELECT e.company_id INTO NEW.company_id
    FROM public.expenses e
    WHERE e.id = NEW.expense_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_expense_items_fill_company_id ON public.expense_items;
CREATE TRIGGER tr_expense_items_fill_company_id
  BEFORE INSERT OR UPDATE OF expense_id ON public.expense_items
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_fill_company_id_from_expense_id();

DROP TRIGGER IF EXISTS tr_recebimentos_fill_company_id ON public.recebimentos;
CREATE TRIGGER tr_recebimentos_fill_company_id
  BEFORE INSERT OR UPDATE OF expense_id ON public.recebimentos
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_fill_company_id_from_expense_id();

CREATE OR REPLACE FUNCTION public.tg_fill_company_id_from_recebimento_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.company_id IS NULL AND NEW.recebimento_id IS NOT NULL THEN
    SELECT r.company_id INTO NEW.company_id
    FROM public.recebimentos r
    WHERE r.id = NEW.recebimento_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_recebimento_item_status_fill_company_id ON public.recebimento_item_status;
CREATE TRIGGER tr_recebimento_item_status_fill_company_id
  BEFORE INSERT OR UPDATE OF recebimento_id ON public.recebimento_item_status
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_fill_company_id_from_recebimento_id();

CREATE OR REPLACE FUNCTION public.tg_fill_company_id_from_supplier_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.company_id IS NULL AND NEW.supplier_id IS NOT NULL THEN
    SELECT s.company_id INTO NEW.company_id
    FROM public.suppliers s
    WHERE s.id = NEW.supplier_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_supplier_payment_info_fill_company_id ON public.supplier_payment_info;
CREATE TRIGGER tr_supplier_payment_info_fill_company_id
  BEFORE INSERT OR UPDATE OF supplier_id ON public.supplier_payment_info
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_fill_company_id_from_supplier_id();

DROP TRIGGER IF EXISTS tr_supplier_update_tokens_fill_company_id ON public.supplier_update_tokens;
CREATE TRIGGER tr_supplier_update_tokens_fill_company_id
  BEFORE INSERT OR UPDATE OF supplier_id ON public.supplier_update_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_fill_company_id_from_supplier_id();

CREATE OR REPLACE FUNCTION public.tg_fill_company_id_from_product_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.company_id IS NULL AND NEW.product_id IS NOT NULL THEN
    SELECT p.company_id INTO NEW.company_id
    FROM public.products p
    WHERE p.id = NEW.product_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_product_category_assignments_fill_company_id ON public.product_category_assignments;
CREATE TRIGGER tr_product_category_assignments_fill_company_id
  BEFORE INSERT OR UPDATE OF product_id ON public.product_category_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_fill_company_id_from_product_id();

CREATE OR REPLACE FUNCTION public.tg_fill_company_id_from_recipe_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.company_id IS NULL AND NEW.recipe_id IS NOT NULL THEN
    SELECT r.company_id INTO NEW.company_id
    FROM public.recipes r
    WHERE r.id = NEW.recipe_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_recipe_ingredients_fill_company_id ON public.recipe_ingredients;
CREATE TRIGGER tr_recipe_ingredients_fill_company_id
  BEFORE INSERT OR UPDATE OF recipe_id ON public.recipe_ingredients
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_fill_company_id_from_recipe_id();

CREATE OR REPLACE FUNCTION public.tg_fill_company_id_from_purchase_order_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.company_id IS NULL AND NEW.order_id IS NOT NULL THEN
    SELECT po.company_id INTO NEW.company_id
    FROM public.purchase_orders po
    WHERE po.id = NEW.order_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_purchase_order_items_fill_company_id ON public.purchase_order_items;
CREATE TRIGGER tr_purchase_order_items_fill_company_id
  BEFORE INSERT OR UPDATE OF order_id ON public.purchase_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_fill_company_id_from_purchase_order_id();

CREATE OR REPLACE FUNCTION public.tg_fill_company_id_from_checklist_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.company_id IS NULL AND NEW.checklist_id IS NOT NULL THEN
    SELECT c.company_id INTO NEW.company_id
    FROM public.checklists c
    WHERE c.id = NEW.checklist_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_checklist_items_fill_company_id ON public.checklist_items;
CREATE TRIGGER tr_checklist_items_fill_company_id
  BEFORE INSERT OR UPDATE OF checklist_id ON public.checklist_items
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_fill_company_id_from_checklist_id();

DROP TRIGGER IF EXISTS tr_checklist_assignments_fill_company_id ON public.checklist_assignments;
CREATE TRIGGER tr_checklist_assignments_fill_company_id
  BEFORE INSERT OR UPDATE OF checklist_id ON public.checklist_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_fill_company_id_from_checklist_id();

DROP TRIGGER IF EXISTS tr_checklist_runs_fill_company_id ON public.checklist_runs;
CREATE TRIGGER tr_checklist_runs_fill_company_id
  BEFORE INSERT OR UPDATE OF checklist_id ON public.checklist_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_fill_company_id_from_checklist_id();
