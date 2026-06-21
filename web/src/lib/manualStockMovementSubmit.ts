import {
  computeManualMovementDelta,
  convertUnitPriceToStockUnit,
  dateInputToIsoMidday,
  type ManualClassification,
  type ManualMovementKind,
  type ManualRegistrationMode,
} from "@/lib/manualStockMovement";
import {
  parseCurrencyInput,
  toStockBaseQuantity,
} from "@/lib/manualStockMovementUnits";
import { supabase } from "@/lib/supabase";
import type { Product } from "@/types/product";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";

export type SubmitManualStockMovementInput = {
  product: Product;
  conversions: ProductUnitConversionDraft[];
  movementKind: ManualMovementKind;
  classification: ManualClassification | null;
  unitCode: string;
  quantityRaw: string;
  unitPriceRaw: string;
  movementDate: string;
  expiryDate?: string;
  registrationMode?: ManualRegistrationMode;
};

export type SubmitManualStockMovementResult =
  | { ok: true }
  | { ok: false; message: string };

export function validateManualStockMovementInput(
  input: SubmitManualStockMovementInput,
): SubmitManualStockMovementResult {
  if (!input.movementDate.trim()) {
    return { ok: false, message: "Informe a data da movimentação." };
  }
  const rawQty = parseFloat(input.quantityRaw.replace(",", "."));
  if (Number.isNaN(rawQty) || rawQty === 0) {
    return { ok: false, message: "Informe uma quantidade válida." };
  }
  if (input.movementKind !== "inventory" && rawQty <= 0) {
    return {
      ok: false,
      message: "Para entrada ou saída, use quantidade positiva.",
    };
  }
  const selectedUnit = input.unitCode.trim();
  if (!selectedUnit) {
    return { ok: false, message: "Selecione uma unidade válida para o produto." };
  }
  if (input.movementKind !== "inventory" && input.classification == null) {
    return { ok: false, message: "Selecione a classificação." };
  }
  return { ok: true };
}

export async function submitManualStockMovement(
  input: SubmitManualStockMovementInput,
): Promise<SubmitManualStockMovementResult> {
  const validation = validateManualStockMovementInput(input);
  if (!validation.ok) return validation;

  const rawQty = parseFloat(input.quantityRaw.replace(",", "."));
  const signedInputQty =
    input.movementKind === "inventory" ? rawQty : Math.abs(rawQty);
  const baseQty = toStockBaseQuantity(
    input.product,
    signedInputQty,
    input.unitCode.trim(),
    input.conversions,
  );
  if (baseQty == null || !Number.isFinite(baseQty) || baseQty <= 0) {
    return {
      ok: false,
      message: "Não foi possível converter a unidade selecionada.",
    };
  }

  const delta = computeManualMovementDelta(
    input.movementKind,
    signedInputQty,
    baseQty,
  );
  const parsedUnitPrice = parseCurrencyInput(input.unitPriceRaw);
  const unitPriceStock =
    parsedUnitPrice != null
      ? convertUnitPriceToStockUnit(
          parsedUnitPrice,
          Math.abs(signedInputQty),
          baseQty,
        )
      : null;

  const { error } = await supabase.rpc("register_manual_stock_movement", {
    p_product_id: input.product.id,
    p_movement_kind: input.movementKind,
    p_classification: input.classification,
    p_delta: delta,
    p_input_quantity: signedInputQty,
    p_input_unit_code: input.unitCode.trim(),
    p_unit_price_stock: unitPriceStock,
    p_movement_at: dateInputToIsoMidday(input.movementDate),
    p_expiry_date: input.expiryDate?.trim() || null,
    p_registration_mode: input.registrationMode ?? "single",
  });

  if (error) {
    console.error(error);
    return {
      ok: false,
      message: error.message.includes("forbidden")
        ? "Sem permissão para registrar movimentação."
        : "Não foi possível registrar a movimentação.",
    };
  }

  return { ok: true };
}

const BATCH_CONCURRENCY = 4;

export async function submitManualStockMovementBatch(
  items: SubmitManualStockMovementInput[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ ok: number; failed: number; lastError?: string }> {
  let ok = 0;
  let failed = 0;
  let lastError: string | undefined;
  const total = items.length;
  let index = 0;

  async function worker() {
    while (index < total) {
      const i = index++;
      const result = await submitManualStockMovement({
        ...items[i]!,
        registrationMode: "batch",
      });
      if (result.ok) {
        ok += 1;
      } else {
        failed += 1;
        lastError = result.message;
      }
      onProgress?.(ok + failed, total);
    }
  }

  const workers = Array.from(
    { length: Math.min(BATCH_CONCURRENCY, total) },
    () => worker(),
  );
  await Promise.all(workers);

  return { ok, failed, lastError };
}
