/** NCM com 8 dígitos; vazio ou só zeros → ausente. */
export function normalizeNcm8(ncm: string | null | undefined): string | null {
  const d = String(ncm ?? "").replace(/\D/g, "");
  if (d.length < 1 || /^0+$/.test(d)) return null;
  if (d.length < 8) return d.padStart(8, "0");
  return d.slice(0, 8);
}

/** Formato de exibição AABB.CC.DD (ex.: 2202.10.00). */
export function formatNcmDisplay(ncm: string | null | undefined): string {
  const n8 = normalizeNcm8(ncm);
  if (!n8) return "—";
  return `${n8.slice(0, 4)}.${n8.slice(4, 6)}.${n8.slice(6, 8)}`;
}

/** Capítulo / posição de 4 dígitos (ex.: 2202). */
export function ncmChapter4(ncm: string | null | undefined): string | null {
  const n8 = normalizeNcm8(ncm);
  if (!n8) return null;
  return n8.slice(0, 4);
}
