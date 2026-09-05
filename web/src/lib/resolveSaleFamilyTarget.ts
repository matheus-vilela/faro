import { createCatalogProduct } from "@/lib/createCatalogProduct";
import { matchProductByTypedName } from "@/lib/outputProductDraft";

export type SaleFamilyTargetOption = {
  id: string;
  name: string;
};

export type SaleFamilyTarget =
  | { kind: "existing"; id: string }
  | { kind: "create"; name: string }
  | { kind: "missing" };

export function resolveSaleFamilyTarget(
  familyProductId: string,
  newFamilyName: string,
  existing: SaleFamilyTargetOption[],
): SaleFamilyTarget {
  if (familyProductId) return { kind: "existing", id: familyProductId };
  const name = newFamilyName.trim();
  if (!name) return { kind: "missing" };
  const match = matchProductByTypedName(existing, name);
  if (match) return { kind: "existing", id: match.id };
  return { kind: "create", name };
}

export async function ensureSaleFamilyProductId(params: {
  companyId: string;
  familyProductId: string;
  newFamilyName: string;
  existing: SaleFamilyTargetOption[];
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const target = resolveSaleFamilyTarget(
    params.familyProductId,
    params.newFamilyName,
    params.existing,
  );
  if (target.kind === "missing") {
    return { ok: false, error: "Escolha ou cadastre um agrupamento." };
  }
  if (target.kind === "existing") return { ok: true, id: target.id };
  const created = await createCatalogProduct({
    companyId: params.companyId,
    name: target.name,
  });
  if (!created.product) {
    return {
      ok: false,
      error: created.error ?? "Não foi possível cadastrar o agrupamento.",
    };
  }
  return { ok: true, id: created.product.id };
}
