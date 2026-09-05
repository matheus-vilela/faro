import { supabase } from "@/lib/supabase";

export type SaleFamilyKind = "none" | "family" | "variant";

export type SaleFamilyMember = {
  id: string;
  variant_product_id: string;
  name: string;
  sku: string | null;
  qty_per_sale: number;
};

export type SaleFamilyInfo = {
  kind: SaleFamilyKind;
  family: {
    id: string;
    name: string;
    sku: string | null;
    qty_per_sale?: number;
    variant_product_id?: string;
  } | null;
  members: SaleFamilyMember[];
};

export type SaleFamilyProductOption = {
  id: string;
  name: string;
  sku: string | null;
  stock_control_type: string | null;
};

function rpcError(error: { message?: string } | null, fallback: string): string {
  return error?.message?.trim() || fallback;
}

export async function listSaleFamilyForProduct(
  companyId: string,
  productId: string,
): Promise<SaleFamilyInfo> {
  const { data, error } = await supabase.rpc("list_sale_family_for_product", {
    p_company_id: companyId,
    p_product_id: productId,
  });
  if (error) throw new Error(rpcError(error, "Não foi possível ler o agrupamento."));
  const raw = (data ?? {}) as {
    kind?: string;
    family?: SaleFamilyInfo["family"];
    members?: SaleFamilyMember[];
  };
  const kind: SaleFamilyKind =
    raw.kind === "family" || raw.kind === "variant" ? raw.kind : "none";
  return {
    kind,
    family: raw.family ?? null,
    members: Array.isArray(raw.members) ? raw.members : [],
  };
}

export async function linkSaleFamilyVariant(params: {
  companyId: string;
  familyProductId: string;
  variantName: string;
  variantSku?: string | null;
  variantUnit?: string | null;
  qtyPerSale: number;
  variantProductId?: string | null;
}): Promise<{
  ok: true;
  family_product_id: string;
  variant_product_id: string;
  created_variant: boolean;
  promoted_family: boolean;
}> {
  const { data, error } = await supabase.rpc("link_sale_family_variant", {
    p_company_id: params.companyId,
    p_family_product_id: params.familyProductId,
    p_variant_name: params.variantName,
    p_variant_sku: params.variantSku ?? null,
    p_variant_unit: params.variantUnit ?? "un",
    p_qty_per_sale: params.qtyPerSale,
    p_variant_product_id: params.variantProductId ?? null,
  });
  if (error) throw new Error(rpcError(error, "Não foi possível vincular a variante."));
  return data as {
    ok: true;
    family_product_id: string;
    variant_product_id: string;
    created_variant: boolean;
    promoted_family: boolean;
  };
}

export async function unlinkSaleFamilyVariant(
  companyId: string,
  variantProductId: string,
): Promise<void> {
  const { error } = await supabase.rpc("unlink_sale_family_variant", {
    p_company_id: companyId,
    p_variant_product_id: variantProductId,
  });
  if (error) throw new Error(rpcError(error, "Não foi possível desvincular."));
}

export async function applyEpocStockVariantOuts(params: {
  companyId: string;
  saleDateIso: string;
  items: Array<{ sku: string; name: string; qty: number | null }>;
}): Promise<{ applied: number; skipped: number; already: number }> {
  const { data, error } = await supabase.rpc("apply_epoc_stock_variant_outs", {
    p_company_id: params.companyId,
    p_sale_date: params.saleDateIso,
    p_items: params.items.map((it) => ({
      sku: it.sku,
      name: it.name,
      qty: it.qty,
    })),
  });
  if (error) throw new Error(rpcError(error, "Não foi possível aplicar as baixas."));
  const raw = (data ?? {}) as {
    applied?: number;
    skipped?: number;
    already?: number;
  };
  return {
    applied: Number(raw.applied ?? 0),
    skipped: Number(raw.skipped ?? 0),
    already: Number(raw.already ?? 0),
  };
}

/** Agrupamento já marcado, ou item da venda do dia (nunca ficha técnica). */
export function isSaleFamilyCandidate(
  product: SaleFamilyProductOption,
  saleNameKeys: Set<string>,
): boolean {
  if (product.stock_control_type === "SALE_FAMILY") return true;
  if (product.stock_control_type === "RECIPE_CONTROLLED") return false;
  if (product.stock_control_type === "INTERMEDIATE") return false;
  return saleNameKeys.has(product.name.trim().toLowerCase());
}

export function saleNameKeys(saleNames: string[]): Set<string> {
  return new Set(saleNames.map((n) => n.trim().toLowerCase()).filter(Boolean));
}

export async function fetchSaleFamilyCandidates(
  companyId: string,
  saleNames: string[],
): Promise<SaleFamilyProductOption[]> {
  const { data, error } = await supabase
    .from("products")
    .select("id, name, sku, stock_control_type")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .or("stock_control_type.eq.SALE_FAMILY,listed_in_product_catalog.eq.true")
    .order("name");
  if (error) throw new Error(rpcError(error, "Não foi possível listar produtos."));
  const rows = (data ?? []) as SaleFamilyProductOption[];
  if (saleNames.length === 0) {
    return rows.filter((p) => p.stock_control_type !== "RECIPE_CONTROLLED");
  }
  const keys = saleNameKeys(saleNames);
  return rows.filter((p) => isSaleFamilyCandidate(p, keys));
}

export function shouldShowPossibleSaleFamilyTag(input: {
  stockControlType: string | null | undefined;
  familyKind: SaleFamilyKind;
  hasOwnSale: boolean;
  seenInStockOuts: boolean;
  notSaleGrouping?: boolean;
}): boolean {
  if (input.notSaleGrouping) return false;
  if (input.stockControlType === "SALE_FAMILY") return false;
  if (input.stockControlType === "RECIPE_CONTROLLED") return false;
  if (input.stockControlType === "INTERMEDIATE") return false;
  if (input.familyKind !== "none") return false;
  if (input.hasOwnSale) return false;
  return input.seenInStockOuts;
}

export function groupingDetailTitle(kind: SaleFamilyKind): string | null {
  if (kind === "family") return "Agrupamento";
  if (kind === "variant") return "Faz parte de um agrupamento";
  return null;
}

export type ProductGroupingRole = "not_grouping" | "self" | "member";

export function productGroupingRole(input: {
  isFamily: boolean;
  inGrouping: boolean;
  possibleGrouping?: boolean;
  dismissed?: boolean;
}): ProductGroupingRole | "" {
  if (input.isFamily) return "self";
  if (input.inGrouping) return "member";
  if (input.possibleGrouping && !input.dismissed) return "";
  return "not_grouping";
}

export function isPossibleGroupingProduct(product: {
  stock_control_type?: string | null;
  stock_only_origin?: boolean;
  not_sale_grouping?: boolean;
}): boolean {
  if (product.not_sale_grouping) return false;
  if (product.stock_control_type === "SALE_FAMILY") return false;
  if (product.stock_control_type === "RECIPE_CONTROLLED") return false;
  if (product.stock_control_type === "INTERMEDIATE") return false;
  return Boolean(product.stock_only_origin);
}

export async function fetchPersistedDayStockOuts(
  companyId: string,
  saleDateIso: string,
): Promise<Array<{ sku: string; nome: string; qtde: number | null; qtde_unidade: string }>> {
  const { data, error } = await supabase
    .from("epoc_day_stock_outs")
    .select("sku, name, qty, unit")
    .eq("company_id", companyId)
    .eq("sale_date", saleDateIso);
  if (error) throw new Error(rpcError(error, "Não foi possível ler o estoque do dia."));
  return ((data ?? []) as Array<{
    sku: string;
    name: string;
    qty: number | null;
    unit: string | null;
  }>).map((r) => ({
    sku: r.sku ?? "",
    nome: r.name,
    qtde: r.qty,
    qtde_unidade: r.unit ?? "",
  }));
}

/** IDs já resolvidos como agrupamento ou variante — saem da fila de correlação. */
export async function fetchResolvedSaleFamilyProductIds(
  companyId: string,
): Promise<Set<string>> {
  const [membersRes, familiesRes] = await Promise.all([
    supabase
      .from("product_sale_family_members")
      .select("family_product_id, variant_product_id")
      .eq("company_id", companyId),
    supabase
      .from("products")
      .select("id")
      .eq("company_id", companyId)
      .eq("stock_control_type", "SALE_FAMILY"),
  ]);
  if (membersRes.error) {
    throw new Error(
      rpcError(membersRes.error, "Não foi possível listar variantes."),
    );
  }
  if (familiesRes.error) {
    throw new Error(
      rpcError(familiesRes.error, "Não foi possível listar agrupamentos."),
    );
  }
  const ids = new Set<string>();
  for (const row of membersRes.data ?? []) {
    const rec = row as {
      family_product_id?: string;
      variant_product_id?: string;
    };
    const familyId = String(rec.family_product_id ?? "").trim();
    const variantId = String(rec.variant_product_id ?? "").trim();
    if (familyId) ids.add(familyId);
    if (variantId) ids.add(variantId);
  }
  for (const row of familiesRes.data ?? []) {
    const id = String((row as { id?: string }).id ?? "").trim();
    if (id) ids.add(id);
  }
  return ids;
}

export async function fetchLinkedSaleFamilyVariantKeys(
  companyId: string,
): Promise<Array<{ sku: string | null; name: string }>> {
  const { data, error } = await supabase
    .from("product_sale_family_members")
    .select("variant_product_id")
    .eq("company_id", companyId);
  if (error) throw new Error(rpcError(error, "Não foi possível listar variantes."));
  const ids = [
    ...new Set(
      (data ?? []).map((r) =>
        String((r as { variant_product_id: string }).variant_product_id),
      ),
    ),
  ];
  if (ids.length === 0) return [];
  const { data: products, error: pErr } = await supabase
    .from("products")
    .select("name, sku")
    .in("id", ids);
  if (pErr) throw new Error(rpcError(pErr, "Não foi possível ler variantes."));
  return ((products ?? []) as Array<{ name: string; sku: string | null }>).map(
    (p) => ({ name: p.name, sku: p.sku }),
  );
}

export async function promoteProductToSaleFamily(
  productId: string,
): Promise<void> {
  const { error } = await supabase.rpc("promote_product_to_sale_family", {
    p_product_id: productId,
  });
  if (error) throw new Error(rpcError(error, "Não foi possível tornar agrupamento."));
}

export async function setProductNotSaleGrouping(
  productId: string,
  notGrouping: boolean,
): Promise<void> {
  const { error } = await supabase.rpc("set_product_not_sale_grouping", {
    p_product_id: productId,
    p_not_grouping: notGrouping,
  });
  if (error) {
    throw new Error(
      rpcError(error, "Não foi possível marcar que não é agrupamento."),
    );
  }
}

export async function demoteProductFromSaleFamily(
  productId: string,
): Promise<void> {
  const { error } = await supabase.rpc("demote_product_from_sale_family", {
    p_product_id: productId,
  });
  if (error) {
    throw new Error(
      rpcError(error, "Não foi possível deixar de ser agrupamento."),
    );
  }
}

async function fetchLinkedVariantIds(companyId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("product_sale_family_members")
    .select("variant_product_id")
    .eq("company_id", companyId);
  if (error) throw new Error(rpcError(error, "Não foi possível listar variantes."));
  return new Set(
    (data ?? []).map((r) => String((r as { variant_product_id: string }).variant_product_id)),
  );
}

export async function fetchVariantPickerOptions(
  companyId: string,
  excludeProductId?: string | null,
): Promise<SaleFamilyProductOption[]> {
  const linked = await fetchLinkedVariantIds(companyId);
  const { data, error } = await supabase
    .from("products")
    .select("id, name, sku, stock_control_type")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .eq("listed_in_product_catalog", true)
    .order("name");
  if (error) throw new Error(rpcError(error, "Não foi possível listar produtos."));
  return ((data ?? []) as SaleFamilyProductOption[]).filter((p) => {
    if (p.id === excludeProductId) return false;
    if (p.stock_control_type === "SALE_FAMILY") return false;
    if (p.stock_control_type === "RECIPE_CONTROLLED") return false;
    return !linked.has(p.id);
  });
}

export type SaleFamilyListRow = {
  id: string;
  name: string;
  sku: string | null;
  members: SaleFamilyMember[];
};

export async function fetchSaleFamilyRows(
  companyId: string,
): Promise<SaleFamilyListRow[]> {
  const { data: families, error } = await supabase
    .from("products")
    .select("id, name, sku")
    .eq("company_id", companyId)
    .eq("stock_control_type", "SALE_FAMILY")
    .order("name");
  if (error) throw new Error(rpcError(error, "Não foi possível listar agrupamentos."));

  const { data: members, error: memErr } = await supabase
    .from("product_sale_family_members")
    .select("id, family_product_id, variant_product_id, qty_per_sale")
    .eq("company_id", companyId);
  if (memErr) throw new Error(rpcError(memErr, "Não foi possível listar variantes."));

  const variantIds = [
    ...new Set(
      (members ?? []).map((m) =>
        String((m as { variant_product_id: string }).variant_product_id),
      ),
    ),
  ];
  const variantById = new Map<string, { name: string; sku: string | null }>();
  if (variantIds.length > 0) {
    const { data: variants, error: vErr } = await supabase
      .from("products")
      .select("id, name, sku")
      .in("id", variantIds);
    if (vErr) throw new Error(rpcError(vErr, "Não foi possível ler variantes."));
    for (const v of variants ?? []) {
      const row = v as { id: string; name: string; sku: string | null };
      variantById.set(row.id, { name: row.name, sku: row.sku });
    }
  }

  const membersByFamily = new Map<string, SaleFamilyMember[]>();
  for (const raw of members ?? []) {
    const m = raw as {
      id: string;
      family_product_id: string;
      variant_product_id: string;
      qty_per_sale: number;
    };
    const vp = variantById.get(m.variant_product_id);
    const list = membersByFamily.get(m.family_product_id) ?? [];
    list.push({
      id: m.id,
      variant_product_id: m.variant_product_id,
      name: vp?.name ?? "Variante",
      sku: vp?.sku ?? null,
      qty_per_sale: Number(m.qty_per_sale),
    });
    membersByFamily.set(m.family_product_id, list);
  }

  return ((families ?? []) as Array<{ id: string; name: string; sku: string | null }>).map(
    (f) => ({
      id: f.id,
      name: f.name,
      sku: f.sku,
      members: (membersByFamily.get(f.id) ?? []).sort((a, b) =>
        a.name.localeCompare(b.name, "pt-BR"),
      ),
    }),
  );
}
