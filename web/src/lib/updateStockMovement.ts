import {
  computeManualMovementDelta,
  convertUnitPriceToStockUnit,
  dateInputToIsoMidday,
  type ManualClassification,
  type ManualMovementKind,
} from "@/lib/manualStockMovement";
import {
  parseCurrencyInput,
  toStockBaseQuantity,
} from "@/lib/manualStockMovementUnits";
import {
  stockMovementEditMode,
  type StockMovementEditRow,
} from "@/lib/stockMovementEdit";
import { supabase } from "@/lib/supabase";
import type { Product } from "@/types/product";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";

export type UpdateStockMovementInput = {
  movement: StockMovementEditRow;
  product: Product;
  conversions: ProductUnitConversionDraft[];
  /** Manual */
  movementKind?: ManualMovementKind;
  classification?: ManualClassification | null;
  unitCode: string;
  quantityRaw: string;
  unitPriceRaw?: string;
  movementDate?: string;
};

export type UpdateStockMovementResult =
  | { ok: true }
  | { ok: false; message: string };

export async function updateStockMovement(
  input: UpdateStockMovementInput,
): Promise<UpdateStockMovementResult> {
  const mode = stockMovementEditMode(input.movement);
  if (mode !== "manual" && mode !== "expense") {
    return {
      ok: false,
      message: "Esta movimentação não pode ser editada por aqui.",
    };
  }

  const rawQty = parseFloat(input.quantityRaw.replace(",", "."));
  if (Number.isNaN(rawQty) || rawQty === 0) {
    return { ok: false, message: "Informe uma quantidade válida." };
  }

  const selectedUnit = input.unitCode.trim();
  if (!selectedUnit) {
    return { ok: false, message: "Selecione uma unidade válida." };
  }

  if (mode === "manual") {
    const kind = input.movementKind ?? "entry";
    if (kind !== "inventory" && rawQty <= 0) {
      return {
        ok: false,
        message: "Para entrada ou saída, use quantidade positiva.",
      };
    }
    if (kind !== "inventory" && input.classification == null) {
      return { ok: false, message: "Selecione a classificação." };
    }
    if (!input.movementDate?.trim()) {
      return { ok: false, message: "Informe a data da movimentação." };
    }

    const signedInputQty = kind === "inventory" ? rawQty : Math.abs(rawQty);
    const baseQty = toStockBaseQuantity(
      input.product,
      signedInputQty,
      selectedUnit,
      input.conversions,
    );
    if (baseQty == null || !Number.isFinite(baseQty) || baseQty <= 0) {
      return {
        ok: false,
        message: "Não foi possível converter a unidade selecionada.",
      };
    }

    const delta = computeManualMovementDelta(
      kind,
      signedInputQty,
      baseQty,
    );
    const parsedUnitPrice = parseCurrencyInput(input.unitPriceRaw ?? "");
    const unitPriceStock =
      parsedUnitPrice != null
        ? convertUnitPriceToStockUnit(
            parsedUnitPrice,
            Math.abs(signedInputQty),
            baseQty,
          )
        : null;

    const { error } = await supabase.rpc("update_stock_movement", {
      p_movement_id: input.movement.id,
      p_payload: {
        product_id: input.product.id,
        quantity: Math.abs(delta),
        input_quantity: signedInputQty,
        input_unit_code: selectedUnit,
        quantity_unit: selectedUnit,
        movement_kind: kind,
        classification: input.classification,
        unit_cost: unitPriceStock,
        movement_at: dateInputToIsoMidday(input.movementDate),
      },
    });

    if (error) {
      console.error(error);
      return {
        ok: false,
        message: error.message.includes("forbidden")
          ? "Sem permissão para editar movimentação."
          : error.message.includes("not editable") ||
              error.message.includes("cannot be edited")
            ? "Esta movimentação não pode ser editada."
            : "Não foi possível salvar a movimentação.",
      };
    }
    return { ok: true };
  }

  // expense / breakdown
  if (rawQty <= 0) {
    return { ok: false, message: "Informe uma quantidade positiva." };
  }
  const baseQty = toStockBaseQuantity(
    input.product,
    rawQty,
    selectedUnit,
    input.conversions,
  );
  if (baseQty == null || !Number.isFinite(baseQty) || baseQty <= 0) {
    return {
      ok: false,
      message: "Não foi possível converter a unidade selecionada.",
    };
  }

  const parsedUnitPrice = parseCurrencyInput(input.unitPriceRaw ?? "");
  const unitPriceStock =
    parsedUnitPrice != null
      ? convertUnitPriceToStockUnit(parsedUnitPrice, rawQty, baseQty)
      : input.movement.unit_cost;

  const { error } = await supabase.rpc("update_stock_movement", {
    p_movement_id: input.movement.id,
    p_payload: {
      product_id: input.product.id,
      quantity: baseQty,
      input_quantity: rawQty,
      input_unit_code: selectedUnit,
      quantity_unit: selectedUnit,
      unit_cost: unitPriceStock,
    },
  });

  if (error) {
    console.error(error);
    return {
      ok: false,
      message: error.message.includes("forbidden")
        ? "Sem permissão para editar movimentação."
        : "Não foi possível salvar a movimentação.",
    };
  }
  return { ok: true };
}
