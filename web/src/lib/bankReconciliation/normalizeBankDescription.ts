/** Chave estável da descrição do extrato para reaproveitar lançamentos anteriores. */
export function normalizeBankDescription(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/\d{5,}/g, " ")
    .replace(/[^A-Z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isUsableBankDescriptionKey(key: string): boolean {
  return key.length >= 4;
}
