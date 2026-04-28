/** Normalização estável para blocking / similaridade textual (NF-e, PT-BR). */
export function normalizeProductDescription(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s%/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function digitsOnly(raw: string | null | undefined): string {
  const d = String(raw ?? "").replace(/\D/g, "");
  return d.length ? d : "";
}

/** Tokens significativos (remove stopwords mínimas). */
export function tokenizeNormalized(norm: string): Set<string> {
  const STOP = new Set([
    "",
    "de",
    "da",
    "do",
    "das",
    "dos",
    "em",
    "para",
    "com",
    "sem",
    "e",
    "ou",
    "a",
    "o",
    "kg",
    "g",
    "ml",
    "l",
    "lt",
    "un",
    "cx",
    "pct",
    "fd",
  ]);
  const parts = norm.split(" ").filter((t) => t.length > 0 && !STOP.has(t));
  return new Set(parts);
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}
