import { digitsOnly } from "./normalize.ts";
import type { DetectedAttributes } from "./types.ts";

const DOMAIN_TERMS = [
  "long neck",
  "lata",
  "pet",
  "garrafa",
  "barril",
  "chopp",
  "zero",
  "diet",
  "premium",
  "tradicional",
  "pack",
  "fardo",
  "litrão",
  "600ml",
  "2l",
  "1l",
];

const VOL_RE =
  /\b(\d+[.,]?\d*)\s*(ml|mL|Ml|ML|l|L|lt|Lt|g|G|kg|KG|kgs|gr|GR)\b/;
const PACK_RE = /\b(\d+)\s*[x×]\s*(\d+[.,]?\d*)\s*(ml|l|kg|g|un)?\b/i;

function pickBrand(norm: string): string | null {
  const known = [
    "heineken",
    "amstel",
    "brahma",
    "skol",
    "eisenbahn",
    "coca-cola",
    "coca cola",
    "pepsi",
    "kuat",
    "sprite",
    "fanta",
    "ype",
    "qboa",
    "caravelas",
    "uniao",
    "união",
  ];
  for (const k of known) {
    const kk = k.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (norm.includes(kk)) return k;
  }
  return null;
}

export function extractAttributesFromDescription(
  original: string,
  norm: string,
  ean: string | null,
): DetectedAttributes {
  const domain_terms: string[] = [];
  const lower = original.toLowerCase();
  for (const d of DOMAIN_TERMS) {
    if (lower.includes(d)) domain_terms.push(d);
  }

  let volume: string | null = null;
  const vm = original.match(VOL_RE);
  if (vm) volume = `${vm[1]}${vm[2]}`.replace(",", ".");

  let pack_qty: string | null = null;
  const pk = original.match(PACK_RE);
  if (pk) pack_qty = pk[0].replace(/\s+/g, "").toUpperCase();

  const brand = pickBrand(norm);

  let base_name = norm
    .replace(/\b\d+[.,]?\d*\s*(ml|l|lt|kg|g)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (brand) {
    const bn = brand.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    base_name = base_name.replace(new RegExp(`\\b${bn}\\b`, "i"), " ").replace(/\s+/g, " ").trim();
  }

  return {
    base_name: base_name || norm,
    brand,
    volume,
    unit: null,
    packaging: domain_terms.some((t) => ["lata", "pet", "long neck", "garrafa"].includes(t))
      ? domain_terms.find((t) => ["lata", "pet", "long neck", "garrafa"].includes(t)) ?? null
      : null,
    pack_qty,
    flavor_variant: null,
    supplier_hint: null,
    ean: ean ? digitsOnly(ean) || null : null,
    domain_terms,
  };
}
