-- Complementa 20260520120000: triggers para tabelas filhas que ainda não preenchiam company_id no INSERT.

CREATE OR REPLACE FUNCTION public.tg_fill_company_id_from_inventory_count_listing_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.company_id IS NULL AND NEW.listing_id IS NOT NULL THEN
    SELECT l.company_id INTO NEW.company_id
    FROM public.inventory_count_listings l
    WHERE l.id = NEW.listing_id;
  END IF;
  IF NEW.company_id IS NULL AND NEW.product_id IS NOT NULL THEN
    SELECT p.company_id INTO NEW.company_id
    FROM public.products p
    WHERE p.id = NEW.product_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_inventory_count_listing_products_fill_company_id
  ON public.inventory_count_listing_products;
CREATE TRIGGER tr_inventory_count_listing_products_fill_company_id
  BEFORE INSERT OR UPDATE OF listing_id, product_id
  ON public.inventory_count_listing_products
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_fill_company_id_from_inventory_count_listing_id();

CREATE OR REPLACE FUNCTION public.tg_fill_company_id_from_inventory_count_session_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.company_id IS NULL AND NEW.session_id IS NOT NULL THEN
    SELECT s.company_id INTO NEW.company_id
    FROM public.inventory_count_sessions s
    WHERE s.id = NEW.session_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_inventory_count_short_links_fill_company_id
  ON public.inventory_count_short_links;
CREATE TRIGGER tr_inventory_count_short_links_fill_company_id
  BEFORE INSERT OR UPDATE OF session_id
  ON public.inventory_count_short_links
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_fill_company_id_from_inventory_count_session_id();

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

DROP TRIGGER IF EXISTS tr_stock_movements_fill_company_id ON public.stock_movements;
CREATE TRIGGER tr_stock_movements_fill_company_id
  BEFORE INSERT OR UPDATE OF product_id
  ON public.stock_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_fill_company_id_from_product_id();

CREATE OR REPLACE FUNCTION public.tg_fill_company_id_from_checklist_run_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.company_id IS NULL AND NEW.run_id IS NOT NULL THEN
    SELECT c.company_id INTO NEW.company_id
    FROM public.checklist_runs cr
    JOIN public.checklists c ON c.id = cr.checklist_id
    WHERE cr.id = NEW.run_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_checklist_run_items_fill_company_id ON public.checklist_run_items;
CREATE TRIGGER tr_checklist_run_items_fill_company_id
  BEFORE INSERT OR UPDATE OF run_id
  ON public.checklist_run_items
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_fill_company_id_from_checklist_run_id();

DROP TRIGGER IF EXISTS tr_checklist_run_short_links_fill_company_id
  ON public.checklist_run_short_links;
CREATE TRIGGER tr_checklist_run_short_links_fill_company_id
  BEFORE INSERT OR UPDATE OF run_id
  ON public.checklist_run_short_links
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_fill_company_id_from_checklist_run_id();

CREATE OR REPLACE FUNCTION public.tg_fill_company_id_from_onboarding_cluster_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.company_id IS NULL AND NEW.cluster_id IS NOT NULL THEN
    SELECT c.company_id INTO NEW.company_id
    FROM public.onboarding_product_cluster c
    WHERE c.id = NEW.cluster_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_onboarding_product_cluster_member_fill_company_id
  ON public.onboarding_product_cluster_member;
CREATE TRIGGER tr_onboarding_product_cluster_member_fill_company_id
  BEFORE INSERT OR UPDATE OF cluster_id
  ON public.onboarding_product_cluster_member
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_fill_company_id_from_onboarding_cluster_id();

CREATE OR REPLACE FUNCTION public.tg_fill_company_id_from_whatsapp_expense_draft_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.company_id IS NULL AND NEW.draft_id IS NOT NULL THEN
    SELECT d.company_id INTO NEW.company_id
    FROM public.whatsapp_expense_drafts d
    WHERE d.id = NEW.draft_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_whatsapp_expense_draft_short_links_fill_company_id
  ON public.whatsapp_expense_draft_short_links;
CREATE TRIGGER tr_whatsapp_expense_draft_short_links_fill_company_id
  BEFORE INSERT OR UPDATE OF draft_id
  ON public.whatsapp_expense_draft_short_links
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_fill_company_id_from_whatsapp_expense_draft_id();

DROP TRIGGER IF EXISTS tr_recebimento_short_links_fill_company_id
  ON public.recebimento_short_links;
CREATE TRIGGER tr_recebimento_short_links_fill_company_id
  BEFORE INSERT OR UPDATE OF recebimento_id
  ON public.recebimento_short_links
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_fill_company_id_from_recebimento_id();
