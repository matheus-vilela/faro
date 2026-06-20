/** CFOP 5910 — remessa em bonificação (não entra no valor cobrado da nota). */

export function normalizeCfop4(cfop: string | null | undefined): string | null {
  const digits = String(cfop ?? "").replace(/\D/g, "").slice(0, 4);
  return digits.length === 4 ? digits : null;
}

export function isNfeBonificationCfop(cfop: string | null | undefined): boolean {
  return normalizeCfop4(cfop) === "5910";
}
