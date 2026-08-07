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
