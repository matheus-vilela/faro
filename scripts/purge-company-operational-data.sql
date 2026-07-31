-- =============================================================================
-- PURGA OPERACIONAL DINÂMICA (por unidade)
-- =============================================================================
-- DESTRUTIVO. Sem undo. Use só com backup / em staging, ou com UUID confirmado.
--
-- Apaga dados operacionais em LOTES (não trava o banco com um DELETE gigante).
-- Filhos sem company_id saem por ON DELETE CASCADE dos pais.
--
-- Arquivo: scripts/purge-company-operational-data.sql
--
-- Como executar (SQL Editor / psql):
--   1. Ajuste v_company (UUID) — OU v_all_companies := true
--   2. Opcional: v_dry_run := true  → só conta
--   3. Opcional: v_batch_size (padrão 2000), v_pause_ms entre lotes
--   4. Rode o script inteiro
--
-- Storage: buckets (nfe-xml, anexos) podem ficar órfãos — limpe à parte se quiser.
-- =============================================================================

DO $$
DECLARE
  -- >>> CONFIGURE AQUI <<<
  v_company         uuid := '00000000-0000-0000-0000-000000000000'::uuid;
  v_all_companies   boolean := false;
  v_dry_run         boolean := false;
  v_batch_size      int := 2000;
  v_pause_ms        int := 20;

  r_company         record;
  v_table           text;
  v_deleted         bigint;
  v_total           bigint;
  v_batch           bigint;
  v_has_table       boolean;
  v_has_company_id  boolean;
  v_hist_keys       text[] := ARRAY[
    'last_epoc_csv_sync_at',
    'last_epoc_csv_storage_path',
    'epoc_daily_sync_rotacao_at',
    'epoc_daily_sync_last_attempt_at',
    'epoc_daily_sync_last_attempt_ok',
    'epoc_daily_sync_last_attempt_outcome',
    'epoc_daily_sync_last_consulted_day_br',
    'epoc_daily_sync_last_attempt_error',
    'epoc_partial_sync_summary',
    'epoc_partial_sync_missing_services_days',
    'epoc_partial_sync_missing_faturamento_days',
    'epoc_partial_sync_at'
  ];

  -- Só tabelas com company_id. Ordem: filhos/RESTRICT antes dos pais.
  -- Cascades documentados no cabeçalho da resposta / comentários abaixo.
  v_steps text[] := ARRAY[
    -- Conciliação (preserva company_bank_accounts)
    'bank_reconciliations',
    'bank_statement_lines',
    'bank_statement_imports',

    -- EPOC / formas de pagamento / serviços
    'epoc_faturamento_daily_payment_methods',  -- RESTRICT → payment_methods
    'epoc_faturamento_daily',
    'service_daily_sales',
    'services',
    'payment_methods',
    'epoc_jobs',
    'epoc_sync_day_status',
    'epoc_sync_state',
    'epoc_csv_sync_runs',
    'integration_csv_revenue_import_jobs',
    'company_revenue_integration_import_batches',

    -- Vendas realizadas
    'revenue_entries',

    -- NF-e / Focus
    'nfe_jobs',
    'nfe_documents',
    'nfe_consulta_history',
    'nfe_sync_state',
    'focus_get_sync_nfe_staging',
    'import_review_pending',
    'import_item_resolution_audit_logs',

    -- WhatsApp operacional
    'whatsapp_expense_drafts',           -- CASCADE short_links se existirem via draft
    'whatsapp_recebimento_menu',
    'whatsapp_inbound_processed',
    'whatsapp_checklist_menu',

    -- Despesas / contas a pagar
    -- CASCADE: expense_items, expense_resolution_logs, recebimentos (+ item_status/short_links)
    'expenses',
    'boletos',                           -- expense_id era SET NULL; apaga residual

    -- Checklists: só execuções (templates preservados)
    -- CASCADE: checklist_run_items, checklist_run_short_links
    'checklist_runs',

    -- Inventário: sessões (grupos/listagens preservados)
    -- CASCADE: inventory_count_short_links
    'inventory_count_sessions',
    'inventory_count_listing_products',

    -- Pedidos / alertas / orçamentos
    'purchase_orders',                   -- CASCADE purchase_order_items
    'company_alerts',
    'company_category_budgets',

    -- Fichas / produtos / estoque
    -- CASCADE recipes→recipe_ingredients, tenant_recipe_template_override;
    -- products→stock_movements, product_*, assignments, etc.
    'recipes',
    'stock_movements',
    'product_waste',
    'product_supplier_codes',
    'product_import_dashboard_review',
    'product_bulk_edit_operations',
    'company_master_catalog_override',
    'company_item_classification_learning',
    'unified_supplier_product_description_history',
    'products',

    -- Fornecedores da unidade
    'supplier_update_tokens',
    'supplier_payment_info',
    'suppliers'
  ];
BEGIN
  IF NOT v_all_companies AND v_company = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION
      'Defina v_company com o UUID da unidade, ou v_all_companies := true.';
  END IF;

  IF v_batch_size < 100 THEN
    RAISE EXCEPTION 'v_batch_size deve ser >= 100 (atual: %)', v_batch_size;
  END IF;

  RAISE NOTICE '=== PURGA OPERACIONAL | dry_run=% | batch=% | pause_ms=% ===',
    v_dry_run, v_batch_size, v_pause_ms;

  FOR r_company IN
    SELECT c.id, c.name
    FROM public.companies c
    WHERE v_all_companies OR c.id = v_company
    ORDER BY c.name
  LOOP
    RAISE NOTICE '';
    RAISE NOTICE '>>> Empresa % (%)', r_company.id, r_company.name;

    -- Short-links de draft WhatsApp (se a tabela tiver company_id via draft join —
    -- apaga drafts depois; se short_links só tem draft_id, CASCADE cuida).
    FOREACH v_table IN ARRAY v_steps
    LOOP
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables t
        WHERE t.table_schema = 'public' AND t.table_name = v_table
      ) INTO v_has_table;

      IF NOT v_has_table THEN
        RAISE NOTICE '  [skip] % (inexistente)', v_table;
        CONTINUE;
      END IF;

      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = v_table
          AND c.column_name = 'company_id'
      ) INTO v_has_company_id;

      IF NOT v_has_company_id THEN
        RAISE NOTICE '  [skip] % (sem company_id — esperado CASCADE de outra tabela)', v_table;
        CONTINUE;
      END IF;

      EXECUTE format(
        'SELECT count(*)::bigint FROM public.%I WHERE company_id = $1',
        v_table
      ) INTO v_total USING r_company.id;

      IF v_total = 0 THEN
        RAISE NOTICE '  [ok] % — 0', v_table;
        CONTINUE;
      END IF;

      IF v_dry_run THEN
        RAISE NOTICE '  [dry] % — % linha(s)', v_table, v_total;
        CONTINUE;
      END IF;

      v_deleted := 0;
      LOOP
        EXECUTE format(
          $q$
            WITH doomed AS (
              SELECT ctid
              FROM public.%I
              WHERE company_id = $1
              LIMIT $2
            )
            DELETE FROM public.%I t
            USING doomed d
            WHERE t.ctid = d.ctid
          $q$,
          v_table,
          v_table
        )
        USING r_company.id, v_batch_size;

        GET DIAGNOSTICS v_batch = ROW_COUNT;
        EXIT WHEN v_batch = 0;
        v_deleted := v_deleted + v_batch;

        IF v_pause_ms > 0 THEN
          PERFORM pg_sleep(v_pause_ms / 1000.0);
        END IF;
      END LOOP;

      RAISE NOTICE '  [del] % — %', v_table, v_deleted;
    END LOOP;

    -- Draft short links sem company_id: limpa órfãos ligados a drafts já apagados
    -- (se ainda existirem por algum motivo). Cascades normalmente bastam.

    IF NOT v_dry_run THEN
      UPDATE public.company_integrations ci
      SET
        settings = (
          SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb)
          FROM jsonb_each(COALESCE(ci.settings, '{}'::jsonb)) AS x(k, v)
          WHERE NOT (k = ANY (v_hist_keys))
        ),
        updated_at = now()
      WHERE ci.company_id = r_company.id;

      UPDATE public.companies c
      SET
        focusnfe = CASE
          WHEN c.focusnfe IS NULL THEN NULL
          ELSE (c.focusnfe
            - 'nfes_recebidas_ultima_sync_at'
            - 'nfes_recebidas_ultima_versao'
          )
        END,
        updated_at = now()
      WHERE c.id = r_company.id;

      RAISE NOTICE '  [cfg] histórico integrações limpo; credenciais preservadas';
    ELSE
      RAISE NOTICE '  [dry] limparia histórico settings/focusnfe cursors';
    END IF;
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE '=== FIM | dry_run=% ===', v_dry_run;
END $$;
