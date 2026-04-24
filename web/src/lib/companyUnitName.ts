import type { Company } from "@/contexts/CompanyContext";

/** Normaliza nome de unidade para comparação (trim + minúsculas). */
export function normalizeCompanyUnitName(name: string): string {
  return name.trim().toLowerCase();
}

type UnitRow = { company: Pick<Company, "id" | "group_id" | "name"> };

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

const DUPLICATE_UNIT_MSG =
  "Já existe uma unidade com este nome neste grupo.";

const FK_VIOLATION_MSG =
  "Esta unidade ainda possui vínculos no banco que impedem a exclusão. Tente novamente mais tarde ou fale com o suporte.";

/** Mensagem amigável para violação de unicidade, FK, PostgREST ou erro genérico. */
export function mapCompanyUnitMutationError(
  err: unknown,
  fallback: string,
): string {
  if (
    err &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  ) {
    return DUPLICATE_UNIT_MSG;
  }
  if (
    err &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code?: string }).code === "23503"
  ) {
    return FK_VIOLATION_MSG;
  }
  if (err instanceof Error) return err.message;
  if (
    err &&
    typeof err === "object" &&
    "message" in err &&
    typeof (err as { message?: unknown }).message === "string"
  ) {
    return (err as { message: string }).message;
  }
  return fallback;
}
