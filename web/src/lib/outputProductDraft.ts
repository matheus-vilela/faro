import { sanitizeCatalogProductName } from "@/lib/productImport/canonicalName";

function normalizeName(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ");
}

/** Casa o nome digitado com um produto já cadastrado (mesmo texto, ignorando caixa/acento). */
export function matchProductByTypedName<T extends { id: string; name: string }>(
  products: T[],
  typed: string,
): T | null {
  const query = normalizeName(typed);
  if (!query) return null;
  const sanitized = normalizeName(sanitizeCatalogProductName(typed));
  return (
    products.find((p) => {
      const name = normalizeName(p.name);
      const catalog = normalizeName(sanitizeCatalogProductName(p.name));
      return (
        name === query ||
        catalog === query ||
        (sanitized.length > 0 && (name === sanitized || catalog === sanitized))
      );
    }) ?? null
  );
}

export function isPlaceholderRecipeName(name: string): boolean {
  const t = name.trim().toLowerCase();
  return !t || t === "nova ficha técnica" || t === "ficha técnica";
}
