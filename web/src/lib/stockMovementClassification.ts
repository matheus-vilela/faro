import { manualClassificationLabel } from "@/lib/manualStockMovement";
import { isWasteStockMovement } from "@/lib/stockMovementFilters";

/** Slugs usados nos filtros de classificação (UI e query). */
export type MovementClassificationFilter =
  | "all"
  | "expense"
  | "sale"
  | "production"
  | "transfer"
  | "internal_consumption"
  | "loss"
  | "inventory"
  | "adjustment"
  | "manual"
  | "recipe"
  | "recebimento"
  | "product_merge"
  | "product_merge_undo";

export const MOVEMENT_CLASSIFICATION_FILTER_OPTIONS: {
  value: MovementClassificationFilter;
  label: string;
}[] = [
  { value: "all", label: "Todas" },
  { value: "expense", label: "Despesa" },
  { value: "sale", label: "Venda" },
  { value: "production", label: "Produção" },
  { value: "transfer", label: "Transferência" },
  { value: "internal_consumption", label: "Consumo interno" },
  { value: "loss", label: "Perda" },
  { value: "inventory", label: "Inventário" },
  { value: "adjustment", label: "Ajuste" },
  { value: "manual", label: "Manual" },
  { value: "recipe", label: "Receita" },
  { value: "recebimento", label: "Recebimento" },
  { value: "product_merge", label: "Unificação" },
];

const REFERENCE_CLASSIFICATION_LABEL: Record<string, string> = {
  inventory_count: "Contagem",
  expense: "Despesa",
  expense_item: "Despesa",
  recebimento: "Recebimento",
  recipe: "Receita",
  revenue_entry: "Venda",
  waste: "Perda",
  adjustment: "Ajuste",
  purchase_order: "Despesa",
  manual: "Manual",
  import_breakdown: "Despesa",
  technical_sheet_backfill: "Ficha técnica",
  product_merge: "Unificação de produtos",
  product_merge_undo: "Desfazer unificação",
};

export type StockMovementClassificationRow = {
  type: string;
  reference_type: string | null;
  metadata_json?: {
    classification?: string;
    movement_kind?: string;
    loser_name?: string;
    undone_at?: string;
  } | null;
};

export function referenceClassificationLabel(
  referenceType: string | null | undefined,
): string | null {
  if (!referenceType?.trim()) return null;
  return REFERENCE_CLASSIFICATION_LABEL[referenceType] ?? referenceType;
}

/** Rótulo exibido na coluna Classificação. */
export function movementClassificationDisplayLabel(
  row: StockMovementClassificationRow,
): string {
  const fromMetadata = manualClassificationLabel(
    row.metadata_json?.classification,
  );
  if (fromMetadata) return fromMetadata;

  if (row.metadata_json?.movement_kind === "inventory") {
    return "Inventário";
  }

  if (row.metadata_json?.undone_at && row.reference_type === "product_merge") {
    return "Unificação desfeita";
  }

  if (row.reference_type === "product_merge") {
    return "Estoque somado na unificação";
  }

  if (row.reference_type === "product_merge_undo") {
    return "Unificação revertida";
  }

  const fromRef = referenceClassificationLabel(row.reference_type);
  if (fromRef) return fromRef;

  if (row.type === "in") return "Despesa";
  if (isWasteStockMovement(row)) return "Perda";
  return "Venda";
}

export function resolveMovementClassificationFilterKey(
  row: StockMovementClassificationRow,
): MovementClassificationFilter | "other" {
  const rawClass = row.metadata_json?.classification?.trim().toLowerCase();
  if (rawClass === "purchase") return "expense";
  if (rawClass === "sale") return "sale";
  if (rawClass === "production") return "production";
  if (rawClass === "transfer") return "transfer";
  if (rawClass === "internal_consumption") return "internal_consumption";
  if (rawClass === "loss") return "loss";

  if (row.metadata_json?.movement_kind === "inventory") return "inventory";

  if (isWasteStockMovement(row)) return "loss";

  const ref = row.reference_type?.trim().toLowerCase() ?? "";
  if (
    ref === "expense_item" ||
    ref === "expense" ||
    ref === "import_breakdown" ||
    ref === "purchase_order"
  ) {
    return "expense";
  }
  if (ref === "revenue_entry") return "sale";
  if (ref === "receipt" || ref === "recebimento") return "recebimento";
  if (ref === "recipe") return "recipe";
  if (ref === "inventory_count") return "inventory";
  if (ref === "adjustment") return "adjustment";
  if (ref === "manual") return "manual";
  if (ref === "waste") return "loss";
  if (ref === "product_merge" || ref === "product_merge_undo") return "product_merge";

  if (row.type === "in") return "expense";
  if (row.type === "out" || row.type === "waste") return "sale";

  return "other";
}

type FilterableQuery = {
  eq: (column: string, value: string) => FilterableQuery;
  or: (filters: string) => FilterableQuery;
};

export function applyStockMovementClassificationFilter<T extends FilterableQuery>(
  query: T,
  classificationFilter: MovementClassificationFilter,
): T {
  if (classificationFilter === "all") return query;

  const parts: string[] = [];

  switch (classificationFilter) {
    case "expense":
      parts.push(
        "metadata_json->>classification.eq.purchase",
        "reference_type.eq.expense_item",
        "reference_type.eq.expense",
        "reference_type.eq.import_breakdown",
        "reference_type.eq.purchase_order",
        "and(type.eq.in,reference_type.is.null)",
      );
      break;
    case "sale":
      parts.push(
        "metadata_json->>classification.eq.sale",
        "reference_type.eq.revenue_entry",
        "and(type.eq.out,reference_type.is.null)",
      );
      break;
    case "production":
      parts.push("metadata_json->>classification.eq.production");
      break;
    case "transfer":
      parts.push("metadata_json->>classification.eq.transfer");
      break;
    case "internal_consumption":
      parts.push("metadata_json->>classification.eq.internal_consumption");
      break;
    case "loss":
      parts.push(
        "type.eq.waste",
        "reference_type.eq.waste",
        "metadata_json->>classification.eq.loss",
      );
      break;
    case "inventory":
      parts.push(
        "metadata_json->>movement_kind.eq.inventory",
        "reference_type.eq.inventory_count",
      );
      break;
    case "adjustment":
      parts.push("reference_type.eq.adjustment");
      break;
    case "manual":
      parts.push("reference_type.eq.manual");
      break;
    case "recipe":
      parts.push("reference_type.eq.recipe");
      break;
    case "recebimento":
      parts.push("reference_type.eq.recebimento");
      break;
    case "product_merge":
      parts.push(
        "reference_type.eq.product_merge",
        "reference_type.eq.product_merge_undo",
      );
      break;
    default:
      return query;
  }

  if (parts.length === 0) return query;
  return query.or(parts.join(",")) as T;
}
