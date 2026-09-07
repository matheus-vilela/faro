import type { Company } from "@/contexts/CompanyContext";

/** Normaliza nome de unidade para comparação (trim + minúsculas). */
export function normalizeCompanyUnitName(name: string): string {
  return name.trim().toLowerCase();
}

/** CNPJ/CPF da unidade só com dígitos. */
export function normalizeCompanyDocument(
  document: string | null | undefined,
): string {
  return String(document ?? "").replace(/\D/g, "");
}

export type UnitRow = {
  company: Pick<Company, "id" | "group_id" | "name"> & {
    document?: string | null;
  };
};

/** Unidades dos grupos cujo dono é `ownerUserId`. */
export function unitRowsForOwner(
  groups: Array<{
    group: { owner_user_id: string };
    companies: UnitRow[];
  }>,
  ownerUserId: string,
): UnitRow[] {
  return groups
    .filter((g) => g.group.owner_user_id === ownerUserId)
    .flatMap((g) => g.companies);
}

/** Verifica se já existe outra unidade no mesmo grupo com o mesmo nome (após normalização). */
export function hasDuplicateUnitNameInGroup(
  name: string,
  groupId: string,
  units: UnitRow[],
  excludeCompanyId?: string,
): boolean {
  const n = normalizeCompanyUnitName(name);
  if (!n) return false;
  return units.some(
    ({ company }) =>
      company.group_id === groupId &&
      company.id !== excludeCompanyId &&
      normalizeCompanyUnitName(company.name) === n,
  );
}

/** Mesmo nome (normalizado) em qualquer unidade da lista. */
export function hasDuplicateUnitName(
  name: string,
  units: UnitRow[],
  excludeCompanyId?: string,
): boolean {
  const n = normalizeCompanyUnitName(name);
  if (!n) return false;
  return units.some(
    ({ company }) =>
      company.id !== excludeCompanyId &&
      normalizeCompanyUnitName(company.name) === n,
  );
}

/** Mesmo CNPJ (14 dígitos) em qualquer unidade da lista. */
export function hasDuplicateUnitDocument(
  document: string | null | undefined,
  units: UnitRow[],
  excludeCompanyId?: string,
): boolean {
  const d = normalizeCompanyDocument(document);
  if (d.length !== 14) return false;
  return units.some(
    ({ company }) =>
      company.id !== excludeCompanyId &&
      normalizeCompanyDocument(company.document) === d,
  );
}

export const DUPLICATE_UNIT_NAME_MSG = "Já existe uma unidade com este nome.";

export const DUPLICATE_UNIT_CNPJ_MSG = "Já existe uma unidade com este CNPJ.";

export const INVALID_CNPJ_DIGITS_MSG = "CNPJ inválido. Confira os dígitos.";

const FK_VIOLATION_MSG =
  "Esta unidade ainda possui vínculos no banco que impedem a exclusão. Tente novamente mais tarde ou fale com o suporte.";

function errField(err: unknown, key: string): unknown {
  if (!err || typeof err !== "object" || !(key in err)) return undefined;
  return (err as Record<string, unknown>)[key];
}

function firstNonEmptyText(...values: unknown[]): string {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/** Mensagem amigável para violação de unicidade, FK, PostgREST ou erro genérico. */
export function mapCompanyUnitMutationError(
  err: unknown,
  fallback: string,
): string {
  const code = String(errField(err, "code") ?? "");
  if (code === "23505") {
    const blob = `${String(errField(err, "message") ?? "")} ${String(
      errField(err, "details") ?? "",
    )}`.toLowerCase();
    if (blob.includes("document")) return DUPLICATE_UNIT_CNPJ_MSG;
    return DUPLICATE_UNIT_NAME_MSG;
  }
  if (code === "23503") {
    return FK_VIOLATION_MSG;
  }
  const fromError = err instanceof Error ? err.message : "";
  const text = firstNonEmptyText(
    fromError,
    errField(err, "message"),
    errField(err, "details"),
    errField(err, "hint"),
  );
  return text || fallback;
}
