/** Tipos compartilhados da área Checklists & Contagem (MVP benchmark). */

export type ChecklistItemType =
  | "check"
  | "numeric"
  | "photo"
  | "note"
  | "rating"
  | "signature"
  | "barcode";

export type ChecklistRunStatus =
  | "open"
  | "submitted"
  | "in_review"
  | "approved"
  | "needs_rework";

/** Envios que contam como realizados na meta (não inclui devolvidos). */
export const CHECKLIST_COMPLETED_STATUSES: ChecklistRunStatus[] = [
  "submitted",
  "in_review",
  "approved",
];

/** Envios visíveis no histórico (auditoria). */
export const CHECKLIST_HISTORY_STATUSES: ChecklistRunStatus[] = [
  "submitted",
  "in_review",
  "approved",
  "needs_rework",
];

const CHECKLIST_RUN_STATUS_LABEL: Record<ChecklistRunStatus, string> = {
  open: "Aberto",
  submitted: "Enviado",
  in_review: "Em conferência",
  approved: "Aprovado",
  needs_rework: "Refazer",
};

export function checklistRunStatusLabel(status: string): string {
  return CHECKLIST_RUN_STATUS_LABEL[status as ChecklistRunStatus] ?? status;
}

export function checklistRunStatusBadgeVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "approved") return "default";
  if (status === "submitted") return "secondary";
  if (status === "needs_rework") return "destructive";
  return "outline";
}

const CHECKLIST_ITEM_TYPE_LABEL: Record<ChecklistItemType, string> = {
  check: "Check",
  numeric: "Número",
  photo: "Foto",
  note: "Nota",
  rating: "Avaliação",
  signature: "Assinatura",
  barcode: "Código",
};

export function checklistItemTypeLabel(type: string): string {
  return CHECKLIST_ITEM_TYPE_LABEL[type as ChecklistItemType] ?? type;
}

export type InventoryCountSessionStatus =
  | "open"
  | "pending_approval"
  | "returned"
  | "approved"
  | "committed";

export type ChecklistItemConfig = {
  /** Meta numérica (tipo numeric) — não revelada ao operador se ocultar_meta. */
  target?: number | null;
  hide_target?: boolean;
  required?: boolean;
  critical?: boolean;
  min?: number | null;
  max?: number | null;
  unit?: string | null;
};

export type StaffScoreAxes = {
  prazo: number;
  completo: number;
  preciso: number;
  /** Média simples dos três eixos (0–100). */
  score: number;
};

export const CHECKLIST_ITEM_TYPES: ChecklistItemType[] = [
  "check",
  "numeric",
  "photo",
  "note",
  "rating",
  "signature",
  "barcode",
];

export const DEFAULT_GEOFENCE_RADIUS_M = 120;
export const DEFAULT_INVENTORY_TOLERANCE_PCT = 5;
