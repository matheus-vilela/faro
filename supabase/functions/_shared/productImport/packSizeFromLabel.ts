/**
 * Heurística determinística: fator de embalagem no nome; massa/volume por unidade;
 * `stripPackSizeFromLabel` remove embalagem e sufixos de massa/volume para cadastro.
 * Paridade com `web/src/lib/productImport/packSizeFromLabel.ts` (Vitest).
 */

export type PackSizeFromLabelResult = {
  packFactor: number | null
  rationale: string | null
}

/** Padrão tipo 10B/400GR ou 6X/500ML: unidades internas × conteúdo por unidade interna. */
export type PackagingNameSlashParse = {
  detected: true
  inner_units: number
  inner_suffix_raw: string
  net_per_inner: string
  pattern_label: "count_suffix_slash_net"
  /** Texto curto para a IA; sufixo desconhecido → sempre «un». */
  inner_label_guess: string
  note: string
}

const MIN_FACTOR = 2
const MAX_FACTOR = 9999

/** Número+letras curtas + / + massa ou volume (por unidade interna). */
const LABEL_SLASH_COMPOSITE_RE =
  /\b(\d{1,4})([A-Za-z]{1,4})\s*\/\s*(\d+(?:[.,]\d+)?)\s*(kg|kgs?|g|gr|gramas?|grama|l|lt|litros?|litro|ml|mililitros?|mililitro)\b/gi

const INNER_SUFFIX_HINTS: Record<string, string> = {
  b: "bandeja (B é comum no setor alimentar)",
  bd: "bandeja",
  tr: "embalagem interna (TR — confirmar)",
  x: "unidade interna / múltiplo (X)",
  un: "unidade",
}

type SlashCompositeMatch = {
  fullMatch: string
  index: number
  innerCount: number
  suffixRaw: string
  netNum: string
  unitRaw: string
}

function findSlashCompositeMatch(productName: string): SlashCompositeMatch | null {
  const name = String(productName ?? "").trim()
  if (!name) return null
  LABEL_SLASH_COMPOSITE_RE.lastIndex = 0
  const m = LABEL_SLASH_COMPOSITE_RE.exec(name)
  if (!m || m.index === undefined) return null
  const innerCount = Number.parseInt(m[1]!, 10)
  if (!Number.isFinite(innerCount) || innerCount < MIN_FACTOR || innerCount > MAX_FACTOR) {
    return null
  }
  const suffixRaw = String(m[2] ?? "").trim()
  if (!suffixRaw.length) return null
  return {
    fullMatch: m[0],
    index: m.index,
    innerCount,
    suffixRaw,
    netNum: m[3]!,
    unitRaw: m[4]!,
  }
}

/** Heurística para o payload da IA (embalagem composta no xProd). */
export function parsePackagingNameSlashPattern(
  productName: string | null | undefined,
): PackagingNameSlashParse | null {
  const hit = findSlashCompositeMatch(String(productName ?? "").trim())
  if (!hit) return null
  const u = hit.unitRaw.toLowerCase()
  const isMass = /^(kg|kgs?|g|gr|gramas?|grama)$/.test(u)
  const unitLabel = isMass
    ? (u.startsWith("kg") || u === "kilo" || u === "kilos" ? "kg" : "g")
    : (u === "ml" || u.startsWith("mililitro") ? "ml" : "l")
  const netPerInner = `${hit.netNum.replace(",", ".")} ${unitLabel}`.trim()
  const key = hit.suffixRaw.toLowerCase()
  const innerGuess = INNER_SUFFIX_HINTS[key] ?? "un"
  return {
    detected: true,
    inner_units: hit.innerCount,
    inner_suffix_raw: hit.suffixRaw,
    net_per_inner: netPerInner,
    pattern_label: "count_suffix_slash_net",
    inner_label_guess: innerGuess,
    note:
      "A quantidade da linha da NF-e (quantity) está na unidade comercial da nota (ex.: CX). Multiplica essa embalagem externa por esta estrutura interna na interpretation (ex.: 3 CX × 10 bandejas × 400 g). Não reduzir o produto só ao peso após a barra.",
  }
}

function stripSlashCompositeFromName(name: string): string {
  const hit = findSlashCompositeMatch(name)
  if (!hit) return name
  const before = name.slice(0, hit.index)
  const after = name.slice(hit.index + hit.fullMatch.length)
  let cleaned = `${before} ${after}`.replace(/\s+/g, " ").trim()
  cleaned = cleaned.replace(/^[.,\-–—/:]+\s*|\s*[.,\-–—/:]+$/g, "").trim()
  if (!cleaned) return name
  return cleaned
}

const LABEL_PACK_PATTERNS: Array<{
  re: RegExp
  label: string
}> = [
  {
    re: /\b(\d{1,4})\s*(?:un|und|unid|unidade|unidades)\b/gi,
    label: "unidade(s) no nome",
  },
  /** Ex.: CEBOLA NACIONAL CX4 → 4 caixas por embalagem de venda no nome. */
  {
    re: /\b(?:cx|caixa)(\d{1,4})\b/gi,
    label: "CXn / caixa+N no nome",
  },
  {
    re: /\b(\d{1,4})\s*(?:pe[cç]as|pe[cç]a|pecas|peca|pcs?|pçs?)\b/gi,
    label: "peça(s) no nome",
  },
  {
    re: /\b(\d{1,4})\s*(?:cx|caixa|caixas)\b/gi,
    label: "caixa(s) no nome",
  },
  {
    re: /\b(\d{1,4})\s*(?:fardo|fd|fds)\b/gi,
    label: "fardo(s) no nome",
  },
  {
    re: /\b(?:cx|caixa|fardo|fd)\s*[x×]\s*(\d{1,4})\b/gi,
    label: "fator após cx/fardo",
  },
]

const LABEL_MASS_VOLUME_PATTERNS: RegExp[] = [
  /\s*[-–—]\s*(\d+(?:[.,]\d+)?)\s*(kg|kgs?|kilo|kilos?|quilo|quilos?|g|gr|gramas?|grama|l|lt|litros?|litro|ml|mililitros?|mililitro)\b/gi,
  /\s*\((\d+(?:[.,]\d+)?)\s*(kg|kgs?|kilo|kilos?|quilo|quilos?|g|gr|gramas?|grama|l|lt|litros?|litro|ml|mililitros?|mililitro)\s*\)/gi,
  /\s+(\d+(?:[.,]\d+)?)\s*(kg|kgs?|kilo|kilos?|quilo|quilos?|g|gr|gramas?|grama)\s*$/i,
  /** Volume no fim do nome: `750 ml`, `750ml`, `1 L` (par com massa na linha acima). */
  /\s+(\d+(?:[.,]\d+)?)\s*(ml|mililitros?|mililitro|l|lt|litros?|litro)\s*$/i,
]

type PackLabelMatch = {
  factor: number
  rationale: string
  fullMatch: string
  index: number
}

type MassVolMatch = {
  fullMatch: string
  index: number
  kg: number | null
  liters: number | null
}

function clampFactor(n: number): number | null {
  if (!Number.isFinite(n) || n < MIN_FACTOR || n > MAX_FACTOR) return null
  return Math.floor(n)
}

function findFirstPackLabelMatch(productName: string): PackLabelMatch | null {
  const maxExec = Math.min(256, productName.length + 48)
  for (const { re, label } of LABEL_PACK_PATTERNS) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    let execCount = 0
    while ((m = re.exec(productName)) !== null) {
      if (++execCount > maxExec) break
      const raw = m[1]
      if (!raw) {
        re.lastIndex = m.index + (m[0].length > 0 ? m[0].length : 1)
        continue
      }
      const f = clampFactor(Number.parseInt(raw, 10))
      if (f == null) {
        re.lastIndex = m.index + (m[0].length > 0 ? m[0].length : 1)
        continue
      }
      return {
        factor: f,
        rationale: `Fator ${f} (${label})`,
        fullMatch: m[0],
        index: m.index,
      }
    }
  }
  return null
}

function parseNumToken(raw: string): number | null {
  const n = Number(String(raw).replace(",", "."))
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

function parseMassVolumeToKgAndLiters(
  numStr: string,
  unitRaw: string,
): { kg: number | null; liters: number | null } {
  const n = parseNumToken(numStr)
  if (n == null) return { kg: null, liters: null }
  const u = String(unitRaw)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
  if (
    u.startsWith("kg") ||
    u === "kilo" ||
    u === "kilos" ||
    u.startsWith("quilo")
  ) {
    return { kg: n, liters: null }
  }
  if (u === "g" || u.startsWith("gr") || u.startsWith("grama")) {
    return { kg: n / 1000, liters: null }
  }
  if (u === "ml" || u.startsWith("mililitro")) {
    return { kg: null, liters: n / 1000 }
  }
  if (u === "l" || u === "lt" || u.startsWith("litro")) {
    return { kg: null, liters: n }
  }
  return { kg: null, liters: null }
}

function collectMassVolumeMatches(productName: string): MassVolMatch[] {
  const out: MassVolMatch[] = []
  const maxExec = Math.min(256, productName.length + 48)
  for (const re of LABEL_MASS_VOLUME_PATTERNS) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    let execCount = 0
    while ((m = re.exec(productName)) !== null) {
      if (++execCount > maxExec) break
      const { kg, liters } = parseMassVolumeToKgAndLiters(m[1]!, m[2]!)
      if (
        (kg != null && kg > 0 && kg <= 1e6) ||
        (liters != null && liters > 0 && liters <= 1e6)
      ) {
        out.push({
          fullMatch: m[0],
          index: m.index,
          kg,
          liters,
        })
      } else {
        re.lastIndex = m.index + (m[0].length > 0 ? m[0].length : 1)
      }
    }
  }
  return out
}

export function massPerCountUnitFromLabelKg(
  productName: string | null | undefined,
): number | null {
  const matches = collectMassVolumeMatches(String(productName ?? "").trim())
  const withKg = matches.filter((x) => x.kg != null && x.kg > 0)
  if (!withKg.length) return null
  withKg.sort((a, b) => a.index - b.index)
  return withKg[withKg.length - 1]!.kg!
}

export function volumePerCountUnitFromLabelLiters(
  productName: string | null | undefined,
): number | null {
  const matches = collectMassVolumeMatches(String(productName ?? "").trim())
  const withL = matches.filter((x) => x.liters != null && x.liters > 0)
  if (!withL.length) return null
  withL.sort((a, b) => a.index - b.index)
  return withL[withL.length - 1]!.liters!
}

function stripLastMassVolumeFromName(name: string): string {
  const matches = collectMassVolumeMatches(name)
  if (!matches.length) return name
  matches.sort((a, b) => a.index - b.index)
  const last = matches[matches.length - 1]!
  const before = name.slice(0, last.index)
  const after = name.slice(last.index + last.fullMatch.length)
  let cleaned = `${before} ${after}`.replace(/\s+/g, " ").trim()
  cleaned = cleaned.replace(/^[.,\-–—/:]+\s*|\s*[.,\-–—/:]+$/g, "").trim()
  if (!cleaned) return name
  return cleaned
}

function stripPackCountFromName(name: string): string {
  const m = findFirstPackLabelMatch(name)
  if (!m) return name
  const before = name.slice(0, m.index)
  const after = name.slice(m.index + m.fullMatch.length)
  let cleaned = `${before} ${after}`.replace(/\s+/g, " ").trim()
  cleaned = cleaned.replace(/^[.,\-–—/:]+\s*|\s*[.,\-–—/:]+$/g, "").trim()
  if (!cleaned) return name
  return cleaned
}

export function stripPackSizeFromLabel(raw: string | null | undefined): string {
  if (raw == null || !String(raw).trim()) {
    return raw == null ? "" : String(raw).trim()
  }
  let name = String(raw).trim()
  name = stripSlashCompositeFromName(name)
  name = stripLastMassVolumeFromName(name)
  name = stripPackCountFromName(name)
  return name
}

export function packSizeFromLabel(
  productName: string | null | undefined,
): PackSizeFromLabelResult {
  if (productName == null || !String(productName).trim()) {
    return { packFactor: null, rationale: null }
  }
  const name = String(productName).trim()
  const slash = findSlashCompositeMatch(name)
  if (slash) {
    return {
      packFactor: slash.innerCount,
      rationale: `Fator ${slash.innerCount} (unidades internas no padrão ${slash.innerCount}${slash.suffixRaw}/${slash.netNum}${slash.unitRaw})`,
    }
  }
  const m = findFirstPackLabelMatch(name)
  if (!m) return { packFactor: null, rationale: null }
  return { packFactor: m.factor, rationale: m.rationale }
}
