-- =============================================================================
-- PURGA DE DADOS DA UNIDADE (preserva company + credenciais PDV/Focus)
-- =============================================================================
-- DESTRUTIVO. Sem undo. Use só com backup / em staging, ou com UUID confirmado.
--
-- Apaga praticamente tudo com company_id, em LOTES, com COMMIT entre lotes
-- (não segura uma transação gigante). Filhos sem company_id saem por CASCADE.
--
-- PRESERVA
--   - public.companies (cadastro da unidade, companies.setup)
--   - login/senha/URL/filial PDV em company_integrations.settings
--   - setup Focus em companies.focusnfe (tokens, id_empresa, CSC, certificado)
--   - acesso à plataforma: user_companies, company_members,
--     company_permission_profiles, company_platform_access
--   - nfe_sync_state / epoc_sync_state (resetados para idle/steady, não apagados)
--   - categorias financeiras padrão (padrao_sistema); só apaga as customizadas
--
-- NÃO PRESERVA (exemplos): vendas, NF-e, despesas, boletos, produtos, fichas,
-- fornecedores, conciliação, contas bancárias, categorias (re-semeadas no fim),
-- histórico de sync, jobs. onboarding_fiscal/pdv ficam completed=true para o
-- painel não reabrir nem disparar sync ao entrar no sistema.
--
-- Storage: buckets (nfe-xml, anexos) podem ficar órfãos — limpe à parte se quiser.
--
-- Como executar:
--   Prefira psql (autocommit entre statements; COMMIT interno funciona):
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/purge-company-operational-data.sql
--   Depois rode o CALL (bloco no final), com UUID real.
--
--   SQL Editor: rode primeiro o CREATE (este arquivo até o COMMENT ON
--   PROCEDURE). Se o CALL falhar com "invalid transaction termination"
--   (2D000), execute o CALL numa segunda query.
--
--   1. Ajuste os argumentos do CALL no final
--   2. Primeiro: p_dry_run := true
--   3. Depois: p_dry_run := false
--   4. Se p_all_companies := true, p_confirm := 'PURGE ALL COMPANIES'
-- =============================================================================

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
  'Última execução de purge_company_operational_data. SELECT depois do CALL — o CALL em si não devolve linhas.';

ALTER TABLE public.purge_company_opdata_last_run ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.purge_company_operational_data_counts()
RETURNS TABLE(table_name text, n bigint)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  r record;
  v_n bigint;
BEGIN
  FOR r IN
    SELECT t.table_name AS rel
    FROM information_schema.tables t
    JOIN information_schema.columns c
      ON c.table_schema = t.table_schema
     AND c.table_name = t.table_name
    WHERE t.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.column_name = 'company_id'
    ORDER BY t.table_name
  LOOP
    EXECUTE format(
      'SELECT count(*)::bigint FROM public.%I',
      r.rel
    ) INTO v_n;
    table_name := r.rel;
    n := v_n;
    RETURN NEXT;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.purge_company_operational_data_counts() IS
  'Conta linhas por tabela public com company_id — use para validar se a purga rodou.';

CREATE OR REPLACE PROCEDURE public.purge_company_opdata_commit_batch()
LANGUAGE plpgsql
AS $$
BEGIN
  COMMIT;
  PERFORM set_config('lock_timeout', '30s', false);
  PERFORM set_config('statement_timeout', '120s', false);
END;
$$;

CREATE OR REPLACE PROCEDURE public.purge_company_opdata_delete_table(
  p_cid uuid,
  p_rel text,
  p_dry boolean,
  p_batch_size int,
  p_pause_ms int
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_exists boolean;
  v_col boolean;
  v_has_padrao boolean;
  v_pred text;
  v_n bigint;
  v_b bigint;
  v_del bigint;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables t
    WHERE t.table_schema = 'public' AND t.table_name = p_rel
  ) INTO v_exists;
  IF NOT v_exists THEN
    RAISE NOTICE '  [skip] % (inexistente)', p_rel;
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = p_rel
      AND c.column_name = 'company_id'
  ) INTO v_col;
  IF NOT v_col THEN
    RAISE NOTICE '  [skip] % (sem company_id — CASCADE de outra tabela)', p_rel;
    RETURN;
  END IF;

  -- Plano de contas seed (padrao_sistema) tem trigger que impede DELETE.
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

  IF p_dry THEN
    EXECUTE format(
      'SELECT count(*)::bigint FROM public.%I WHERE %s',
      p_rel,
      v_pred
    ) INTO v_n USING p_cid;
    INSERT INTO public.purge_company_opdata_last_run (
      dry_run, company_id, table_name, action, n
    ) VALUES (
      true, p_cid, p_rel, CASE WHEN v_n = 0 THEN 'ok' ELSE 'dry' END, v_n
    );
    IF v_n = 0 THEN
      RAISE NOTICE '  [ok] % — 0', p_rel;
    ELSE
      RAISE NOTICE '  [dry] % — % linha(s)', p_rel, v_n;
    END IF;
    RETURN;
  END IF;

  v_del := 0;
  LOOP
    EXECUTE format(
      $q$
        WITH doomed AS (
          SELECT ctid
          FROM public.%I
          WHERE %s
          LIMIT $2
        )
        DELETE FROM public.%I t
        USING doomed d
        WHERE t.ctid = d.ctid
      $q$,
      p_rel,
      v_pred,
      p_rel
    )
    USING p_cid, p_batch_size;

    GET DIAGNOSTICS v_b = ROW_COUNT;
    EXIT WHEN v_b = 0;
    v_del := v_del + v_b;

    CALL public.purge_company_opdata_commit_batch();
    IF p_pause_ms > 0 THEN
      PERFORM pg_sleep(p_pause_ms / 1000.0);
    END IF;
  END LOOP;

  INSERT INTO public.purge_company_opdata_last_run (
    dry_run, company_id, table_name, action, n
  ) VALUES (
    false, p_cid, p_rel, CASE WHEN v_del = 0 THEN 'ok' ELSE 'del' END, v_del
  );

  IF v_del = 0 THEN
    RAISE NOTICE '  [ok] % — 0', p_rel;
  ELSE
    RAISE NOTICE '  [del] % — %', p_rel, v_del;
  END IF;
END;
$$;

CREATE OR REPLACE PROCEDURE public.purge_company_operational_data(
  p_company uuid DEFAULT NULL,
  p_all_companies boolean DEFAULT false,
  p_dry_run boolean DEFAULT true,
  p_confirm text DEFAULT '',
  p_batch_size int DEFAULT 2000,
  p_pause_ms int DEFAULT 20
)
LANGUAGE plpgsql
AS $$
DECLARE
  r_company record;
  r_gap record;
  v_table text;
  v_total bigint;
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
BEGIN
  PERFORM set_config('lock_timeout', '30s', false);
  PERFORM set_config('statement_timeout', '120s', false);
  PERFORM set_config('search_path', 'public', false);

  IF p_batch_size < 100 THEN
    RAISE EXCEPTION 'p_batch_size deve ser >= 100 (atual: %)', p_batch_size;
  END IF;

  IF p_all_companies THEN
    IF p_confirm IS DISTINCT FROM 'PURGE ALL COMPANIES' THEN
      RAISE EXCEPTION
        'p_all_companies exige p_confirm := ''PURGE ALL COMPANIES''.';
    END IF;
  ELSE
    IF p_company IS NULL
       OR p_company = '00000000-0000-0000-0000-000000000000'::uuid THEN
      RAISE EXCEPTION
        'Defina p_company com o UUID da unidade, ou p_all_companies := true.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = p_company) THEN
      RAISE EXCEPTION 'company_id % não existe em public.companies', p_company;
    END IF;
  END IF;

  DELETE FROM public.purge_company_opdata_last_run;

  RAISE NOTICE '=== PURGA UNIDADE | dry_run=% | batch=% | pause_ms=% | all=% ===',
    p_dry_run, p_batch_size, p_pause_ms, p_all_companies;

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

  FOR r_company IN
    SELECT c.id, c.name
    FROM public.companies c
    WHERE p_all_companies OR c.id = p_company
    ORDER BY c.name
  LOOP
    RAISE NOTICE '';
    RAISE NOTICE '>>> Empresa % (%)', r_company.id, r_company.name;

    IF NOT p_dry_run THEN
      IF to_regclass('public.nfe_sync_state') IS NOT NULL THEN
        UPDATE public.nfe_sync_state s
        SET
          status = 'idle',
          running_since = NULL,
          next_sync_at = now() + interval '7 days',
          updated_at = now()
        WHERE s.company_id = r_company.id;
      END IF;
      IF to_regclass('public.epoc_sync_state') IS NOT NULL THEN
        UPDATE public.epoc_sync_state s
        SET
          status = 'idle',
          running_since = NULL,
          next_sync_at = now() + interval '7 days',
          updated_at = now()
        WHERE s.company_id = r_company.id;
      END IF;
      CALL public.purge_company_opdata_commit_batch();
      RAISE NOTICE '  [pause] pipelines nfe/epoc em idle por 7 dias';
    END IF;

    FOREACH v_table IN ARRAY v_steps
    LOOP
      CALL public.purge_company_opdata_delete_table(
        r_company.id, v_table, p_dry_run, p_batch_size, p_pause_ms
      );
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
      ORDER BY t.table_name
    LOOP
      IF p_dry_run THEN
        EXECUTE format(
          'SELECT count(*)::bigint FROM public.%I WHERE company_id = $1',
          r_gap.table_name
        ) INTO v_total USING r_company.id;
        RAISE NOTICE '  [gap] % — % linha(s) (fora da lista ordenada; seria apagada no sweep)',
          r_gap.table_name, v_total;
      ELSE
        CALL public.purge_company_opdata_delete_table(
          r_company.id, r_gap.table_name, false, p_batch_size, p_pause_ms
        );
      END IF;
    END LOOP;

    IF p_dry_run THEN
      RAISE NOTICE '  [dry] limparia settings PDV (só credenciais), focusnfe (só setup); onboarding fiscal/pdv completed; re-semearias categorias';
      CONTINUE;
    END IF;

    UPDATE public.company_integrations ci
    SET
      settings = (
        SELECT COALESCE(jsonb_object_agg(x.k, x.v), '{}'::jsonb)
        FROM jsonb_each(COALESCE(ci.settings, '{}'::jsonb)) AS x(k, v)
        WHERE x.k = ANY (v_cred_keys)
      ),
      updated_at = now()
    WHERE ci.company_id = r_company.id;

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
    WHERE c.id = r_company.id;

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
      WHERE s.company_id = r_company.id;
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
      WHERE s.company_id = r_company.id;
    END IF;

    BEGIN
      PERFORM public.seed_financial_categories_v3(r_company.id);
      RAISE NOTICE '  [seed] categorias financeiras';
    EXCEPTION
      WHEN undefined_function THEN
        RAISE NOTICE '  [seed] seed_financial_categories_v3 ausente';
    END;

    BEGIN
      PERFORM public.seed_company_product_categories(r_company.id);
      RAISE NOTICE '  [seed] categorias de produto';
    EXCEPTION
      WHEN undefined_function THEN
        RAISE NOTICE '  [seed] seed_company_product_categories ausente';
    END;

    CALL public.purge_company_opdata_commit_batch();
    RAISE NOTICE '  [cfg] credenciais PDV/Focus preservadas; onboarding fiscal/PDV completed; pipelines em steady';
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE '=== FIM | dry_run=% ===', p_dry_run;
END;
$$;

COMMENT ON PROCEDURE public.purge_company_operational_data(uuid, boolean, boolean, text, int, int) IS
  'Purga dados da unidade em lotes (COMMIT entre lotes). Preserva company, credenciais PDV/Focus e acesso à plataforma.';

REVOKE ALL ON PROCEDURE public.purge_company_opdata_commit_batch() FROM PUBLIC;
REVOKE ALL ON PROCEDURE public.purge_company_opdata_delete_table(uuid, text, boolean, int, int) FROM PUBLIC;
REVOKE ALL ON PROCEDURE public.purge_company_operational_data(uuid, boolean, boolean, text, int, int) FROM PUBLIC;

-- Conferir se ainda há dados (devolve linhas no Results):
--   SELECT * FROM public.purge_company_operational_data_counts()
--   WHERE n > 0 ORDER BY n DESC;
--
-- Depois de um CALL, o log da execução:
--   SELECT * FROM public.purge_company_opdata_last_run
--   WHERE n > 0 ORDER BY n DESC;
--
-- >>> DEPOIS DO CREATE: rode o CALL numa query à parte <<<
--
-- Uma unidade (UUID real, não placeholder):
-- CALL public.purge_company_operational_data(
--   p_company         := '11111111-1111-1111-1111-111111111111'::uuid,
--   p_all_companies   := false,
--   p_dry_run         := true,
--   p_confirm         := '',
--   p_batch_size      := 2000,
--   p_pause_ms        := 20
-- );
--
-- Todas as unidades (p_company NULL; exige a frase de confirmação):
-- CALL public.purge_company_operational_data(
--   p_company         := NULL,
--   p_all_companies   := true,
--   p_dry_run         := true,
--   p_confirm         := 'PURGE ALL COMPANIES',
--   p_batch_size      := 2000,
--   p_pause_ms        := 20
-- );
--
-- Apagar de verdade: p_dry_run := false
