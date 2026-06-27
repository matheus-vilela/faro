import { supabase } from "@/lib/supabase";
import {
  BULK_EDIT_ERROR_MESSAGES,
  type BulkEditApplyResult,
  type BulkEditFieldKey,
  type BulkEditOperationSummary,
  type BulkEditPreviewResult,
  type BulkEditUndoResult,
} from "@/types/productBulkEdit";

function mapError(code: string, fallback?: string): string {
  return BULK_EDIT_ERROR_MESSAGES[code] ?? fallback ?? code;
}

export async function previewProductBulkEdit(
  companyId: string,
  productIds: string[],
  fieldKey: BulkEditFieldKey,
  changes: Record<string, unknown>,
): Promise<BulkEditPreviewResult> {
  const { data, error } = await supabase.rpc("preview_product_bulk_edit", {
    p_company_id: companyId,
    p_product_ids: productIds,
    p_field_key: fieldKey,
    p_changes: changes,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const row = data as BulkEditPreviewResult & { max?: number };
  if (!row?.ok) {
    return {
      ok: false,
      error: mapError(String((row as { error?: string }).error ?? "preview_failed")),
      max: row.max,
    };
  }
  return row;
}

export async function applyProductBulkEdit(
  companyId: string,
  productIds: string[],
  fieldKey: BulkEditFieldKey,
  changes: Record<string, unknown>,
): Promise<BulkEditApplyResult> {
  const { data, error } = await supabase.rpc("apply_product_bulk_edit", {
    p_company_id: companyId,
    p_product_ids: productIds,
    p_field_key: fieldKey,
    p_changes: changes,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const row = data as BulkEditApplyResult & { max?: number };
  if (!row?.ok) {
    return {
      ok: false,
      error: mapError(String((row as { error?: string }).error ?? "apply_failed")),
      max: row.max,
    };
  }
  return {
    ok: true,
    operation_id: String(row.operation_id),
    updated_count: Number(row.updated_count ?? 0),
  };
}

export async function getUndoableProductBulkEdit(
  companyId: string,
): Promise<BulkEditOperationSummary | null> {
  const { data, error } = await supabase.rpc("get_undoable_product_bulk_edit", {
    p_company_id: companyId,
  });

  if (error) {
    console.error(error);
    return null;
  }

  const row = data as {
    ok?: boolean;
    operation?: BulkEditOperationSummary | null;
  };
  if (!row?.ok || !row.operation) return null;
  return row.operation;
}

export async function undoProductBulkEdit(
  companyId: string,
  operationId: string,
): Promise<BulkEditUndoResult> {
  const { data, error } = await supabase.rpc("undo_product_bulk_edit", {
    p_company_id: companyId,
    p_operation_id: operationId,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const row = data as {
    ok?: boolean;
    error?: string;
    operation_id?: string;
    restored_count?: number;
  };

  if (!row?.ok) {
    return {
      ok: false,
      error: mapError(String(row.error ?? "undo_failed")),
    };
  }

  return {
    ok: true,
    operation_id: String(row.operation_id ?? operationId),
    restored_count: Number(row.restored_count ?? 0),
  };
}
