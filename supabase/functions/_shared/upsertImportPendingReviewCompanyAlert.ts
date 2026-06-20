/**
 * Mantém `company_alerts` (kind import_pending_review) alinhado a `import_review_pending` OPEN.
 * Usado no fim do lote XML e após o motor `process-expense-xml-products`.
 */

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export async function upsertImportPendingReviewCompanyAlert(
  supabase: SupabaseClient,
  companyId: string,
): Promise<void> {
  const { count: pendingOpenCount, error: cntErr } = await supabase
    .from("import_review_pending")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("status", "OPEN");
  if (cntErr) return;
  if ((pendingOpenCount ?? 0) > 0) {
    await supabase.from("company_alerts").upsert(
      {
        company_id: companyId,
        kind: "import_pending_review",
        severity: "warning",
        dedupe_key: "import_pending_review_open",
        title: "Pendências de importação",
        message: `${pendingOpenCount} item(ns) de importação precisam de revisão.`,
        link_path: "/app",
        payload: { open_pending_count: pendingOpenCount },
        status: "open",
      },
      { onConflict: "company_id,dedupe_key" },
    );
  } else {
    await supabase
      .from("company_alerts")
      .delete()
      .eq("company_id", companyId)
      .eq("dedupe_key", "import_pending_review_open");
  }
}
