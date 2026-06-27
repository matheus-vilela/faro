import type { OperationalItemType } from "@/lib/itemClassification/operationalItemTypes";

/** Campos elegíveis para edição em lote (v1). */
export const BULK_EDIT_FIELD_KEYS = [
  "ncm",
  "product_categories",
  "is_active",
  "composes_cmv",
  "cmv_category_id",
  "operational_type",
] as const;

export type BulkEditFieldKey = (typeof BULK_EDIT_FIELD_KEYS)[number];

export type ProductCategoryBulkMode = "replace" | "add" | "remove";

export type BulkEditChanges =
  | { value: string | null }
  | { value: boolean }
  | {
      mode: ProductCategoryBulkMode;
      category_ids: string[];
    }
  | { value: OperationalItemType };

export type BulkEditPreviewItem = {
  product_id: string;
  product_name: string;
  before: string;
  after: string;
  warnings: string[];
};

export type BulkEditPreviewResult =
  | {
      ok: true;
      items: BulkEditPreviewItem[];
      total_count: number;
      preview_limit: number;
      truncated: boolean;
    }
  | { ok: false; error: string; max?: number };

export type BulkEditApplyResult =
  | { ok: true; operation_id: string; updated_count: number }
  | { ok: false; error: string; max?: number };

export type BulkEditOperationSummary = {
  id: string;
  field_key: BulkEditFieldKey;
  changes: BulkEditChanges;
  updated_count: number;
  created_at: string;
  expires_at: string;
};

export type BulkEditUndoResult =
  | { ok: true; operation_id: string; restored_count: number }
  | { ok: false; error: string };

export const BULK_EDIT_MAX_PRODUCTS = 500;

export const BULK_EDIT_ERROR_MESSAGES: Record<string, string> = {
  not_authenticated: "Sessão expirada. Entre novamente.",
  forbidden: "Sem permissão. Apenas gestor ou proprietário pode editar em lote.",
  empty_selection: "Selecione ao menos um produto.",
  too_many_products: `Limite de ${BULK_EDIT_MAX_PRODUCTS} produtos por operação.`,
  no_valid_products: "Nenhum produto válido encontrado na seleção.",
  invalid_field: "Campo não permitido para edição em lote.",
  operation_not_found: "Operação não encontrada.",
  already_undone: "Esta operação já foi desfeita.",
  expired: "A janela de 24 horas para desfazer expirou.",
  not_latest_operation: "Só é possível desfazer a última operação em lote.",
};
