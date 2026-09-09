-- Purga operacional da unidade ativa (Ferramentas). Mesma regra do script
-- scripts/purge-company-operational-data.sql, sem COMMIT entre lotes (RPC).

CREATE TABLE IF NOT EXISTS public.purge_company_opdata_last_run (
  id bigserial PRIMARY KEY,
  ran_at timestamptz NOT NULL DEFAULT now(),
  dry_run boolean NOT NULL,
  company_id uuid,
  table_name text NOT NULL,
  action text NOT NULL,
  n bigint NOT NULL DEFAULT 0
);

COMMENT ON TABLE public.purge_company_opdata_last_run IS
  'Log da última purga operacional de unidade.';

ALTER TABLE public.purge_company_opdata_last_run ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.purge_company_opdata_delete_rows(
  p_cid uuid,
  p_rel text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exists boolean;
  v_col boolean;
  v_has_padrao boolean;
  v_pred text;
  v_del bigint := 0;
  v_b bigint;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables t
    WHERE t.table_schema = 'public' AND t.table_name = p_rel
  ) INTO v_exists;
  IF NOT v_exists THEN
    RETURN 0;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = p_rel
      AND c.column_name = 'company_id'
  ) INTO v_col;
  IF NOT v_col THEN
    RETURN 0;
  END IF;

  v_pred := 'company_id = $1';
  IF p_rel = 'company_categories' THEN
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = 'company_categories'
        AND c.column_name = 'padrao_sistema'
    ) INTO v_has_padrao;
    IF v_has_padrao THEN
      v_pred := v_pred || ' AND COALESCE(padrao_sistema, false) = false';
    END IF;
  END IF;

  LOOP
    EXECUTE format(
      $q$
        WITH doomed AS (
          SELECT ctid
          FROM public.%I
          WHERE %s
          LIMIT 2000
        )
        DELETE FROM public.%I t
        USING doomed d
        WHERE t.ctid = d.ctid
      $q$,
      p_rel,
      v_pred,
      p_rel
    )
    USING p_cid;
    GET DIAGNOSTICS v_b = ROW_COUNT;
    EXIT WHEN v_b = 0;
    v_del := v_del + v_b;
  END LOOP;

  INSERT INTO public.purge_company_opdata_last_run (
    dry_run, company_id, table_name, action, n
  ) VALUES (
    false, p_cid, p_rel, CASE WHEN v_del = 0 THEN 'ok' ELSE 'del' END, v_del
  );

  RETURN v_del;
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_active_company_operational_data(
  p_company_id uuid,
  p_confirm text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_table text;
  v_total bigint := 0;
  v_nfe_window date;
  v_epoc_window date;
  v_cred_keys text[] := ARRAY[
    'username',
    'password',
    'base_url',
    'codigo_filial',
    'ambiente'
  ];
  v_focus_keys text[] := ARRAY[
    'modelo',
    'csc_nfce_producao',
    'id_token_nfce_producao',
    'csc_nfce_homologacao',
    'id_token_nfce_homologacao',
    'serie',
    'proximoNumeroNfce',
    'certificado_ativo',
    'certificado_validade',
    'token_homologacao',
    'token_producao',
    'id_empresa'
  ];
  v_keep text[] := ARRAY[
    'company_integrations',
    'user_companies',
    'company_members',
    'company_permission_profiles',
    'company_platform_access',
    'nfe_sync_state',
    'epoc_sync_state',
    'setup_certificate_delegation_links'
  ];
  v_steps text[] := ARRAY[
    'nfe_jobs',
    'epoc_jobs',
    'focus_get_sync_nfe_interpret_jobs',
    'integration_csv_revenue_import_jobs',
    'bank_reconciliations',
    'bank_statement_lines',
    'bank_statement_imports',
    'epoc_faturamento_daily_payment_methods',
    'epoc_faturamento_daily',
    'service_daily_sales',
    'services',
    'payment_methods',
    'acquirers',
    'epoc_sync_day_status',
    'epoc_csv_sync_runs',
    'company_revenue_integration_import_batches',
    'revenue_entries',
    'nfe_documents',
    'nfe_consulta_history',
    'focus_get_sync_nfe_staging',
    'import_review_pending',
    'import_item_resolution_audit_logs',
    'company_nfe_import_logs',
    'import_job_timeline',
    'import_job_items',
    'import_job_files',
    'import_job_batches',
    'onboarding_product_cluster_member',
    'onboarding_product_cluster',
    'onboarding_import_item_raw',
    'onboarding_reconciliation_runs',
    'onboarding_catalog_decision_memory',
    'import_recipe_draft_components',
    'import_recipe_drafts',
    'product_match_proposal_links',
    'product_match_proposals',
    'product_match_nodes',
    'product_match_runs',
    'whatsapp_expense_draft_short_links',
    'whatsapp_expense_drafts',
    'whatsapp_recebimento_menu',
    'whatsapp_inbound_processed',
    'whatsapp_checklist_menu',
    'recebimento_item_status',
    'recebimento_short_links',
    'recebimentos',
    'expense_xml_item_motor_pass',
    'expense_resolution_logs',
    'expense_items',
    'expenses',
    'boletos',
    'checklist_run_short_links',
    'checklist_run_items',
    'checklist_runs',
    'checklist_assignments',
    'checklist_items',
    'checklists',
    'checklist_templates',
    'checklist_notification_settings',
    'staff_performance_links',
    'inventory_count_lines',
    'inventory_count_short_links',
    'inventory_count_sessions',
    'inventory_count_listing_products',
    'inventory_count_listings',
    'inventory_count_groups',
    'purchase_order_items',
    'purchase_orders',
    'company_alerts',
    'company_category_budgets',
    'company_revenue_category_tax_settings',
    'recipe_ingredients',
    'tenant_recipe_template_override',
    'recipes',
    'stock_movements',
    'product_waste',
    'product_supplier_codes',
    'product_import_dashboard_review',
    'product_bulk_edit_operations',
    'product_invoice_line_aliases',
    'product_import_equivalences',
    'product_operational_config',
    'product_unit_rules',
    'product_unit_conversions',
    'product_category_assignments',
    'company_master_catalog_override',
    'company_item_classification_learning',
    'unified_supplier_product_description_history',
    'unified_supplier_product_company_prices',
    'import_item_resolution_rules',
    'products',
    'company_product_categories',
    'company_product_import_settings',
    'company_unit_conversions',
    'company_units',
    'company_custom_unit_aliases',
    'supplier_update_tokens',
    'supplier_payment_info',
    'suppliers',
    'company_bank_accounts',
    'company_categories'
  ];
  r_gap record;
BEGIN
  PERFORM set_config('lock_timeout', '30s', true);
  PERFORM set_config('statement_timeout', '180s', true);

  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;
  IF NOT public.is_platform_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;
  IF p_company_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'company_id obrigatório');
  END IF;

  SELECT c.name INTO v_name
  FROM public.companies c
  WHERE c.id = p_company_id;
  IF v_name IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'company_not_found');
  END IF;
  IF btrim(coalesce(p_confirm, '')) = ''
     OR lower(btrim(p_confirm)) IS DISTINCT FROM lower(btrim(v_name)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'confirm_mismatch');
  END IF;

  DELETE FROM public.purge_company_opdata_last_run;

  BEGIN
    v_nfe_window := public.nfe_default_window_start_date();
  EXCEPTION
    WHEN undefined_function THEN
      v_nfe_window := (timezone('America/Sao_Paulo', now()))::date;
  END;
  BEGIN
    v_epoc_window := public.epoc_default_window_start_date();
  EXCEPTION
    WHEN undefined_function THEN
      v_epoc_window := (timezone('America/Sao_Paulo', now()))::date;
  END;

  IF to_regclass('public.nfe_sync_state') IS NOT NULL THEN
    UPDATE public.nfe_sync_state s
    SET
      status = 'idle',
      running_since = NULL,
      next_sync_at = now() + interval '7 days',
      updated_at = now()
    WHERE s.company_id = p_company_id;
  END IF;
  IF to_regclass('public.epoc_sync_state') IS NOT NULL THEN
    UPDATE public.epoc_sync_state s
    SET
      status = 'idle',
      running_since = NULL,
      next_sync_at = now() + interval '7 days',
      updated_at = now()
    WHERE s.company_id = p_company_id;
  END IF;

  FOREACH v_table IN ARRAY v_steps
  LOOP
    v_total := v_total + public.purge_company_opdata_delete_rows(p_company_id, v_table);
  END LOOP;

  FOR r_gap IN
    SELECT t.table_name
    FROM information_schema.tables t
    JOIN information_schema.columns c
      ON c.table_schema = t.table_schema
     AND c.table_name = t.table_name
    WHERE t.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.column_name = 'company_id'
      AND t.table_name <> ALL (v_keep)
      AND t.table_name <> ALL (v_steps)
      AND t.table_name <> 'purge_company_opdata_last_run'
    ORDER BY t.table_name
  LOOP
    v_total := v_total + public.purge_company_opdata_delete_rows(
      p_company_id,
      r_gap.table_name
    );
  END LOOP;

  UPDATE public.company_integrations ci
  SET
    settings = (
      SELECT COALESCE(jsonb_object_agg(x.k, x.v), '{}'::jsonb)
      FROM jsonb_each(COALESCE(ci.settings, '{}'::jsonb)) AS x(k, v)
      WHERE x.k = ANY (v_cred_keys)
    ),
    updated_at = now()
  WHERE ci.company_id = p_company_id;

  UPDATE public.companies c
  SET
    focusnfe = CASE
      WHEN c.focusnfe IS NULL THEN NULL
      ELSE (
        SELECT COALESCE(jsonb_object_agg(x.k, x.v), '{}'::jsonb)
        FROM jsonb_each(c.focusnfe) AS x(k, v)
        WHERE x.k = ANY (v_focus_keys)
      )
    END,
    onboarding_fiscal = jsonb_build_object(
      'sync', false,
      'max_nfes_sync', 0,
      'nfes_sync', 0,
      'nfes_ignored', 0,
      'completed', true,
      'capture_completed', true,
      'sefaz_unavailable', false
    ),
    onboarding_pdv = jsonb_build_object(
      'completed', true,
      'sync', false,
      'sales_total', 0,
      'sales_sync', 0,
      'portal_busy', false,
      'portal_outcome', NULL,
      'portal_message', NULL,
      'import_status', 'completed',
      'import_error', NULL,
      'csv_import_job_id', NULL,
      'csv_storage_path', NULL,
      'import_started_at', NULL
    ),
    updated_at = now()
  WHERE c.id = p_company_id;

  IF to_regclass('public.nfe_sync_state') IS NOT NULL THEN
    UPDATE public.nfe_sync_state s
    SET
      mode = 'steady',
      status = 'idle',
      priority = 0,
      cursor_versao = 0,
      pending_cursor_versao = NULL,
      cycle_id = NULL,
      running_since = NULL,
      empty_poll_count = 0,
      listed_count = 0,
      downloaded_count = 0,
      ignored_count = 0,
      failed_count = 0,
      last_error = NULL,
      next_sync_at = now() + interval '7 days',
      window_start_date = COALESCE(v_nfe_window, s.window_start_date),
      updated_at = now()
    WHERE s.company_id = p_company_id;
  END IF;

  IF to_regclass('public.epoc_sync_state') IS NOT NULL THEN
    UPDATE public.epoc_sync_state s
    SET
      mode = 'steady',
      status = 'idle',
      priority = 0,
      cycle_id = NULL,
      running_since = NULL,
      last_csv_sync_run_id = NULL,
      last_import_job_id = NULL,
      last_error = NULL,
      last_outcome = NULL,
      empty_poll_count = 0,
      next_sync_at = now() + interval '7 days',
      window_start_date = COALESCE(v_epoc_window, s.window_start_date),
      updated_at = now()
    WHERE s.company_id = p_company_id;
  END IF;

  BEGIN
    PERFORM public.seed_financial_categories_v4(p_company_id);
  EXCEPTION
    WHEN undefined_function THEN
      NULL;
  END;
  BEGIN
    PERFORM public.seed_company_product_categories(p_company_id);
  EXCEPTION
    WHEN undefined_function THEN
      NULL;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'company_id', p_company_id,
    'rows_deleted', v_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.purge_company_opdata_delete_rows(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_active_company_operational_data(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_active_company_operational_data(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.purge_active_company_operational_data(uuid, text) IS
  'Admin Faro: apaga dados operacionais da unidade. Preserva company, setup, credenciais EPOC/Focus e acesso.';
