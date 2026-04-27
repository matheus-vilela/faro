import type { MasterRecipeDefinition } from "@/lib/masterRecipeCatalog/types";
import { masterRecipeDefinitionByExternalKey, MASTER_RECIPE_DEFINITIONS } from "@/lib/masterRecipeCatalog/seedRegistry";
import { resolveMasterItemCatalog } from "@/lib/masterItemCatalog/resolveMasterItemCatalog";
import type { SupabaseClient } from "@supabase/supabase-js";

const DEF_BY_ID = new Map(MASTER_RECIPE_DEFINITIONS.map((d) => [d.id, d]));

export type FlattenedIngredientLine = {
  masterItemId: string;
  inputQuantity: number;
  inputUnitCode: string;
  lossFactor: number;
  sortOrder: number;
};

/**
 * Expande sub-receitas (MASTER_RECIPE) em linhas de insumos, escalando quantidades.
 */
export function flattenMasterRecipeDefinition(
  def: MasterRecipeDefinition,
  scale: number,
  visited: Set<string>,
  sortBase: number,
): FlattenedIngredientLine[] {
  if (visited.has(def.id)) {
    throw new Error(`Sub-receita em ciclo: ${def.id}`);
  }
  visited.add(def.id);
  const ordered = [...def.components].sort((a, b) => a.sortOrder - b.sortOrder);
  const out: FlattenedIngredientLine[] = [];
  let i = 0;
  for (const c of ordered) {
    const order = sortBase + i * 0.01;
    i += 1;
    if (c.componentKind === "MASTER_ITEM") {
      const q = c.quantity * c.yieldFactor * scale;
      out.push({
        masterItemId: c.masterItemId!,
        inputQuantity: q,
        inputUnitCode: c.unitCode,
        lossFactor: c.wasteFactor,
        sortOrder: order,
      });
    } else {
      const child = DEF_BY_ID.get(c.masterRecipeId ?? "");
      if (!child) continue;
      out.push(...flattenMasterRecipeDefinition(child, scale * c.quantity, visited, order));
    }
  }
  visited.delete(def.id);
  return out;
}

/**
 * Agrupa linhas que cairiam no mesmo par (masterItem, unidade) para respeitar UNIQUE (recipe_id, product_id)
 * após resolução para produto.
 */
export function mergeFlattenedLines(lines: FlattenedIngredientLine[]): FlattenedIngredientLine[] {
  const m = new Map<string, FlattenedIngredientLine>();
  for (const L of lines) {
    const k = `${L.masterItemId}\0${L.inputUnitCode.toLowerCase()}`;
    const cur = m.get(k);
    if (!cur) {
      m.set(k, { ...L });
    } else {
      cur.inputQuantity += L.inputQuantity;
      cur.lossFactor = Math.max(cur.lossFactor, L.lossFactor);
      cur.sortOrder = Math.min(cur.sortOrder, L.sortOrder);
    }
  }
  return [...m.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

export function pickCompanyProductForMasterItem(
  masterItemId: string,
  products: Array<{ id: string; name: string }>,
  productOverrides?: Record<string, string> | null,
): { productId: string } | null {
  const o = productOverrides?.[masterItemId];
  if (o) return { productId: o };

  let best: { id: string; score: number } | null = null;
  for (const p of products) {
    const m = resolveMasterItemCatalog({ name: p.name });
    if (m?.masterId !== masterItemId) continue;
    if (!best || m.effectiveScore > best.score) {
      best = { id: p.id, score: m.effectiveScore };
    }
  }
  return best ? { productId: best.id } : null;
}

type RpcIngredientRow = {
  product_id: string;
  quantity: number;
  input_quantity: number;
  input_unit_code: string;
  loss_factor: number;
  sort_order: number;
};

/** Após resolver produto, une linhas que apontam ao mesmo SKU (constraint única por receita + produto). */
export function mergeRpcIngredientRowsByProduct(rows: RpcIngredientRow[]): RpcIngredientRow[] {
  const m = new Map<string, RpcIngredientRow>();
  for (const r of rows) {
    const k = `${r.product_id}\0${r.input_unit_code.toLowerCase()}`;
    const cur = m.get(k);
    if (!cur) {
      m.set(k, { ...r });
    } else {
      cur.quantity += r.quantity;
      cur.input_quantity += r.input_quantity;
      cur.loss_factor = Math.max(cur.loss_factor, r.loss_factor);
      cur.sort_order = Math.min(cur.sort_order, r.sort_order);
    }
  }
  return [...m.values()].sort((a, b) => a.sort_order - b.sort_order).map((row, i) => ({
    ...row,
    sort_order: i + 1,
  }));
}

export type InstantiateMasterRecipeArgs = {
  companyId: string;
  outputProductId: string;
  masterRecipeExternalKey: string;
  /** Todos os produtos da empresa (para casar master item → produto por nome). */
  companyProducts: Array<{ id: string; name: string }>;
  /** Chave mestre de item → UUID de produto (optional). */
  productOverrides?: Record<string, string> | null;
  supersedeRecipeId?: string | null;
  recipeDisplayName?: string | null;
};

export type InstantiateMasterRecipeResult =
  | { ok: true; recipeId: string; version: number }
  | {
      ok: false;
      error: string;
      unresolvedMasterItems?: string[];
    };

export type BuildInstantiationPayloadResult =
  | { ok: true; ingredients: RpcIngredientRow[] }
  | {
      ok: false;
      error: string;
      unresolvedMasterItems?: string[];
    };

/**
 * Monta o payload validado para `instantiate_master_recipe_for_company` (pode ser usado em testes).
 */
export function buildInstantiationIngredientPayload(args: InstantiateMasterRecipeArgs): BuildInstantiationPayloadResult {
  const def = masterRecipeDefinitionByExternalKey(args.masterRecipeExternalKey);
  if (!def) {
    return { ok: false, error: "template_not_found" };
  }
  let flat: FlattenedIngredientLine[];
  try {
    flat = mergeFlattenedLines(flattenMasterRecipeDefinition(def, 1, new Set(), 0));
  } catch {
    return { ok: false, error: "flatten_failed" };
  }

  const unresolved: string[] = [];
  const rows: RpcIngredientRow[] = [];
  let sort = 1;
  for (const line of flat) {
    const pick = pickCompanyProductForMasterItem(
      line.masterItemId,
      args.companyProducts,
      args.productOverrides,
    );
    if (!pick) {
      unresolved.push(line.masterItemId);
      continue;
    }
    rows.push({
      product_id: pick.productId,
      quantity: line.inputQuantity,
      input_quantity: line.inputQuantity,
      input_unit_code: line.inputUnitCode.toLowerCase(),
      loss_factor: line.lossFactor,
      sort_order: sort,
    });
    sort += 1;
  }

  if (unresolved.length > 0) {
    return {
      ok: false,
      error: "unresolved_master_items",
      unresolvedMasterItems: [...new Set(unresolved)],
    };
  }
  if (rows.length === 0) {
    return { ok: false, error: "no_ingredients" };
  }
  return { ok: true, ingredients: mergeRpcIngredientRowsByProduct(rows) };
}

export async function instantiateMasterRecipeFromTemplate(
  client: SupabaseClient,
  args: InstantiateMasterRecipeArgs,
): Promise<InstantiateMasterRecipeResult> {
  const built = buildInstantiationIngredientPayload(args);
  if (!built.ok) {
    return {
      ok: false,
      error: built.error,
      unresolvedMasterItems: built.unresolvedMasterItems,
    };
  }

  const { data, error } = await client.rpc("instantiate_master_recipe_for_company", {
    p_company_id: args.companyId,
    p_output_product_id: args.outputProductId,
    p_master_external_key: args.masterRecipeExternalKey,
    p_ingredients: built.ingredients,
    p_supersede_recipe_id: args.supersedeRecipeId ?? null,
    p_recipe_display_name: args.recipeDisplayName ?? null,
  });

  if (error) {
    return { ok: false, error: error.message };
  }
  const o = data as { ok?: boolean; error?: string; recipe_id?: string; version?: number };
  if (!o?.ok) {
    return { ok: false, error: o?.error ?? "rpc_failed" };
  }
  if (!o.recipe_id) {
    return { ok: false, error: "missing_recipe_id" };
  }
  return { ok: true, recipeId: o.recipe_id, version: Number(o.version ?? 1) };
}
