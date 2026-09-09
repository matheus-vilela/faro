/**
 * Interpreta valor monetário digitado em pt-BR (20.213,88) ou já
 * normalizado (20213.88). Não aplicar replace de ponto/vírgula antes.
 */
export function parseMoneyPtBr(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }

  const trimmed = String(raw)
    .replace(/\u00a0/g, " ")
    .trim()
    .replace(/R\$\s?/gi, "")
    .replace(/\s/g, "");

  if (!trimmed || !/\d/.test(trimmed)) return null;

  const lastComma = trimmed.lastIndexOf(",");
  const lastDot = trimmed.lastIndexOf(".");

  let normalized: string;
  if (lastComma > lastDot) {
    normalized = trimmed.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma) {
    const frac = trimmed.slice(lastDot + 1);
    const dotCount = (trimmed.match(/\./g) ?? []).length;
    if (dotCount === 1 && /^\d{1,2}$/.test(frac)) {
      normalized = trimmed.replace(/,/g, "");
    } else {
      normalized = trimmed.replace(/\./g, "").replace(",", ".");
    }
  } else {
    normalized = trimmed.replace(",", ".");
  }

  const n = Number.parseFloat(normalized.replace(/[^\d.+-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

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
