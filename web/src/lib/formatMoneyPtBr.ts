/** Formata número como moeda pt-BR (R$). */
export function formatMoneyPtBr(
  value: number | null | undefined,
  opts?: { fallback?: string },
): string {
  if (value == null || !Number.isFinite(value)) {
    return opts?.fallback ?? "—";
  }
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function formatNumberPtBr(
  value: number | null | undefined,
  fractionDigits = 2,
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/** yyyy-MM-dd → dd/MM/aaaa */
export function formatIsoDateBr(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}
