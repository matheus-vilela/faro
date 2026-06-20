/**
 * Bebidas com marca: volumes/embalagens diferentes = SKUs diferentes
 * (ex.: Heineken 330 ml ≠ Heineken 600 ml ≠ Heineken barril 50 L).
 */
import { normalizeInvoiceProductLabel, stripDiacriticsLower } from "./canonicalName.ts";
import { volumePerCountUnitFromLabelLiters } from "./packSizeFromLabel.ts";

const BEVERAGE_CATEGORY_TOKENS = new Set([
  "refrigerante",
  "refri",
  "suco",
  "nectar",
  "cerveja",
  "cerv",
  "chopp",
  "chope",
  "vodka",
  "whisky",
  "whiskey",
  "gin",
  "rum",
  "cachaca",
  "energetico",
  "isotonico",
  "agua",
  "vinho",
  "espumante",
  "prosecco",
  "sake",
  "draft",
  "beer",
  "long",
  "neck",
]);

const BEVERAGE_PACKAGING_TOKENS = new Set([
  "ln",
  "gfa",
  "lata",
  "garrafa",
  "pet",
  "vidro",
  "growler",
  "barril",
  "keg",
  "litro",
  "litros",
]);

const KNOWN_BEVERAGE_BRANDS = new Set([
  "heineken",
  "amstel",
  "skol",
  "brahma",
  "stella",
  "budweiser",
  "bud",
  "corona",
  "antarctica",
  "original",
  "bohemia",
  "spaten",
  "eisenbahn",
  "patagonia",
  "coca",
  "pepsi",
  "fanta",
  "sprite",
  "schweppes",
  "crystal",
  "bonafont",
  "minalba",
  "indaia",
  "redbull",
  "monster",
  "gatorade",
  "powerade",
]);

const VOLUME_INLINE_RE =
  /\b(\d+(?:[.,]\d+)?)\s*(ml|mililitros?|mililitro|m[lL]|lt|litros?|litro|l)\b/gi;
const VOLUME_TIGHT_RE = /\b(\d+(?:[.,]\d+)?)(ml|m[lL]|lt|litro|l)\b/gi;
const GFA_VOLUME_RE = /\b(\d+(?:[.,]\d+)?)\s*gfa\b|\b(\d+(?:[.,]\d+)?)gfa\b/gi;

function parseVolumeTokenToMl(numStr: string, unitRaw: string): number | null {
  const n = Number(String(numStr).replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  const u = stripDiacriticsLower(unitRaw);
  if (u === "ml" || u.startsWith("mililitro")) return Math.round(n);
  if (u === "l" || u === "lt" || u.startsWith("litro")) return Math.round(n * 1000);
  return null;
}

/** Volume principal do SKU em ml (último trecho volume/GFA no rótulo). */
export function extractBeverageVolumeMl(
  raw: string | null | undefined,
): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;

  const liters = volumePerCountUnitFromLabelLiters(s);
  if (liters != null && liters > 0) return Math.round(liters * 1000);

  let last: number | null = null;
  let lastIdx = -1;

  const consider = (idx: number, ml: number | null) => {
    if (ml == null || ml <= 0) return;
    if (idx >= lastIdx) {
      lastIdx = idx;
      last = ml;
    }
  };

  for (const re of [VOLUME_INLINE_RE, VOLUME_TIGHT_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) {
      consider(m.index, parseVolumeTokenToMl(m[1]!, m[2]!));
    }
  }

  GFA_VOLUME_RE.lastIndex = 0;
  let g: RegExpExecArray | null;
  while ((g = GFA_VOLUME_RE.exec(s)) !== null) {
    const numStr = g[1] ?? g[2];
    if (!numStr) continue;
    const n = Number(String(numStr).replace(",", "."));
    if (Number.isFinite(n) && n > 0) consider(g.index, Math.round(n * 1000));
  }

  return last;
}

export function isBeverageSkuLine(raw: string | null | undefined): boolean {
  const n = normalizeInvoiceProductLabel(raw);
  if (!n) return false;
  const tok = n.split(" ").filter(Boolean);
  if (tok.some((t) => BEVERAGE_CATEGORY_TOKENS.has(t))) return true;
  if (tok.some((t) => BEVERAGE_PACKAGING_TOKENS.has(t))) return true;
  if (/\bdraft\s+beer\b/.test(n) || /\blong\s+neck\b/.test(n)) return true;
  if (extractBeverageVolumeMl(raw) != null && tok.some((t) => KNOWN_BEVERAGE_BRANDS.has(t))) {
    return true;
  }
  return false;
}

function volumeMlTolerance(a: number, b: number): number {
  return Math.max(25, 0.02 * Math.max(a, b));
}

/**
 * true = não deve vincular automaticamente (volumes/embalagens de bebida divergentes).
 */
export function beverageSkuVolumeConflict(
  invoiceLine: string | null | undefined,
  catalogName: string | null | undefined,
): boolean {
  if (!isBeverageSkuLine(invoiceLine) || !isBeverageSkuLine(catalogName)) {
    return false;
  }

  const va = extractBeverageVolumeMl(invoiceLine);
  const vb = extractBeverageVolumeMl(catalogName);

  if (va != null && vb != null) {
    return Math.abs(va - vb) > volumeMlTolerance(va, vb);
  }

  // Só um lado declara volume → SKUs distintos (ex.: cadastro "HEINEKEN" vs nota "HEINEKEN 0,33 LT").
  if (va != null || vb != null) return true;

  return false;
}
