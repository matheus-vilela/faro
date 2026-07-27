/** Converte número pt-BR (`1.234,56` / `-47,79`) em number; vazio → null. */
export function parsePtBrNumber(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  let s = String(raw)
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .trim();
  if (!s) return null;
  s = s.replace(/[R$\s]/gi, "");
  const neg =
    /^\(.*\)$/.test(s) ||
    s.startsWith("-") ||
    s.endsWith("-");
  s = s.replace(/[()]/g, "").replace(/^-/, "").replace(/-$/, "");
  if (!s) return null;
  // milhar com ponto + decimal com vírgula
  if (/\d\.\d{3}/.test(s) && s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -Math.abs(n) : n;
}

/** dd/MM/aaaa → yyyy-MM-dd */
export function brDateToIso(br: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br.trim());
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** yyyy-MM-dd → dd/MM/aaaa */
export function isoDateToBr(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** `66ad1d11ca7bb - AMEX_credito` → sku + nome. */
export function splitPaymentMethodLabel(raw: string): {
  sku: string;
  name: string;
} {
  const t = raw.trim();
  const sep = " - ";
  const idx = t.indexOf(sep);
  if (idx <= 0) {
    return { sku: t || "unknown", name: t || "Desconhecido" };
  }
  const sku = t.slice(0, idx).trim();
  const name = t.slice(idx + sep.length).trim();
  return {
    sku: sku || t,
    name: name || t,
  };
}
