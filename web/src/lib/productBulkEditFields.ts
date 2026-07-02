import { OPERATIONAL_ITEM_TYPES } from "@/lib/itemClassification/operationalItemTypes";
import type { BulkEditFieldKey } from "@/types/productBulkEdit";

export type BulkEditFieldMeta = {
  key: BulkEditFieldKey;
  label: string;
  group: string;
  inputType:
    | "text"
    | "boolean"
    | "categories"
    | "operational_type"
    | "cmv_category";
  placeholder?: string;
};

export const BULK_EDIT_FIELDS: BulkEditFieldMeta[] = [
  {
    key: "ncm",
    label: "NCM",
    group: "Fiscal",
    inputType: "text",
    placeholder: "8 dígitos",
  },
  {
    key: "product_categories",
    label: "Categorias de produto",
    group: "Taxonomia",
    inputType: "categories",
  },
  {
    key: "is_active",
    label: "Ativo no catálogo",
    group: "Cadastro",
    inputType: "boolean",
  },
  {
    key: "composes_cmv",
    label: "Compõe CMV",
    group: "CMV",
    inputType: "boolean",
  },
  {
    key: "cmv_category_id",
    label: "Categoria CMV (financeira)",
    group: "CMV",
    inputType: "cmv_category",
  },
  {
    key: "operational_type",
    label: "Tipo operacional",
    group: "Operacional",
    inputType: "operational_type",
  },
];

const OPERATIONAL_LABELS: Record<string, string> = {
  INSUMO: "Insumo",
  PRODUTO_REVENDA: "Revenda",
  ITEM_OPERACIONAL: "Operacional",
  RECEITA_FICHA: "Receita / ficha",
  NAO_ESTOCAVEL: "Não estocável",
  REVISAO_PENDENTE: "Revisão pendente",
};

export function bulkEditFieldLabel(key: BulkEditFieldKey): string {
  return BULK_EDIT_FIELDS.find((f) => f.key === key)?.label ?? key;
}

export function bulkEditFieldsByGroup(): Map<string, BulkEditFieldMeta[]> {
  const map = new Map<string, BulkEditFieldMeta[]>();
  for (const field of BULK_EDIT_FIELDS) {
    const list = map.get(field.group) ?? [];
    list.push(field);
    map.set(field.group, list);
  }
  return map;
}

export function operationalTypeOptions(): Array<{ value: string; label: string }> {
  return OPERATIONAL_ITEM_TYPES.map((t) => ({
    value: t,
    label: OPERATIONAL_LABELS[t] ?? t,
  }));
}

export function operationalTypeLabel(value: string | null | undefined): string {
  if (!value || value === "—") return "—";
  return OPERATIONAL_LABELS[value] ?? value;
}

/** Formata células before/after da pré-visualização (UUID → rótulo legível). */
export function formatBulkEditPreviewDisplay(
  fieldKey: BulkEditFieldKey,
  raw: string,
  lookups: {
    productCategoryNames: Record<string, string>;
    cmvCategoryNames: Record<string, string>;
  },
): string {
  if (!raw || raw === "—") return "—";

  if (fieldKey === "product_categories") {
    return formatCategoryIdListPreview(raw, lookups.productCategoryNames);
  }
  if (fieldKey === "cmv_category_id") {
    const id = raw.trim();
    if (!id) return "Nenhuma";
    return lookups.cmvCategoryNames[id] ?? raw;
  }
  if (fieldKey === "operational_type") {
    return operationalTypeLabel(raw);
  }
  return raw;
}

function formatCategoryIdListPreview(
  raw: string,
  nameById: Record<string, string>,
): string {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "[]") return "Nenhuma";
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return "Nenhuma";
    return parsed
      .map((id) => nameById[String(id)] ?? String(id))
      .join(", ");
  } catch {
    return raw;
  }
}

export function buildBulkEditChangesPayload(
  fieldKey: BulkEditFieldKey,
  raw: {
    textValue?: string;
    boolValue?: boolean;
    categoryMode?: "replace" | "add" | "remove";
    categoryIds?: string[];
    operationalType?: string;
    cmvCategoryId?: string | null;
  },
): Record<string, unknown> {
  const field = BULK_EDIT_FIELDS.find((f) => f.key === fieldKey);
  if (!field) return {};

  switch (field.inputType) {
    case "boolean":
      return { value: raw.boolValue ?? true };
    case "categories":
      return {
        mode: raw.categoryMode ?? "replace",
        category_ids: raw.categoryIds ?? [],
      };
    case "operational_type":
      return { value: raw.operationalType ?? "INSUMO" };
    case "cmv_category":
      return { value: raw.cmvCategoryId ?? null };
    default:
      return {
        value:
          raw.textValue === undefined ? null : raw.textValue.trim() || null,
      };
  }
}
