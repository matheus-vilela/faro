export function localDateYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** YYYY-MM from YYYY-MM-DD */
export function monthInputFromYmd(ymd: string): string {
  return ymd.trim().slice(0, 7);
}

/** YYYY-MM-01 from input type="month" (YYYY-MM) */
export function competenceDateFromMonthInput(monthValue: string): string {
  const mk = monthValue.trim().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(mk)) return "";
  return `${mk}-01`;
}

export function formatCompetenceLabel(competenceDate: string | null | undefined): string {
  if (!competenceDate?.trim()) return "—";
  const mk = competenceDate.trim().slice(0, 7);
  const [y, m] = mk.split("-");
  const monthNum = parseInt(m, 10);
  if (!y || !monthNum) return competenceDate;
  const label = new Date(parseInt(y, 10), monthNum - 1, 1).toLocaleDateString(
    "pt-BR",
    { month: "long", year: "numeric" },
  );
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function parseNonNegativeAmount(value: string): number {
  const n = parseFloat(value.replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

export function computePaidAmount(
  original: number,
  interest: number,
  discount: number,
): number {
  const base = Number.isFinite(original) ? original : 0;
  const j = Number.isFinite(interest) ? interest : 0;
  const d = Number.isFinite(discount) ? discount : 0;
  return Math.round((base + j - d) * 100) / 100;
}

export function roundMoney(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

/** Valor restante após um pagamento parcial da face da conta. */
export function remainderAmount(original: number, payAmount: number): number {
  return roundMoney(roundMoney(original) - roundMoney(payAmount));
}

export function isValidPartialPayAmount(
  original: number,
  payAmount: number,
): boolean {
  const pay = roundMoney(payAmount);
  const rem = remainderAmount(original, pay);
  return pay > 0 && rem > 0;
}
