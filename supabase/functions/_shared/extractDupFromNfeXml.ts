/**
 * Extrai parcelas (`cobr/dup`) de XML NF-e (nfeProc ou NFe) para criar boletos a pagar.
 */
import { XMLParser } from "npm:fast-xml-parser@4.5.0";

function num(v: unknown): number {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t.length ? t : null;
}

/** Converte dVenc NF-e (AAAA-MM-DD ou DD/MM/AAAA) para YYYY-MM-DD. */
function normalizeDueDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return null;
}

export type NfeDupRow = {
  nDup: string | null;
  dueDateYmd: string;
  amount: number;
};

export function extractDuplicatesFromNfeXml(xmlText: string): NfeDupRow[] {
  const trimmed = xmlText.trim();
  if (!trimmed.startsWith("<")) return [];

  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    trimValues: true,
  });

  let root: Record<string, unknown>;
  try {
    root = parser.parse(trimmed) as Record<string, unknown>;
  } catch {
    return [];
  }

  const nfeProc = root.nfeProc as Record<string, unknown> | undefined;
  const nfeRoot = (nfeProc?.NFe ?? root.NFe) as Record<string, unknown> | undefined;
  const infNFe = nfeRoot?.infNFe as Record<string, unknown> | undefined;
  if (!infNFe?.cobr) return [];

  const cobr = infNFe.cobr as Record<string, unknown>;
  let dupRaw = cobr.dup as unknown;
  if (dupRaw == null) return [];
  const dups = Array.isArray(dupRaw) ? dupRaw : [dupRaw];

  const out: NfeDupRow[] = [];
  for (const raw of dups) {
    const d = raw as Record<string, unknown>;
    const due = normalizeDueDate(d.dVenc ?? (d["@_dVenc"] as string | undefined));
    const amount = num(d.vDup ?? d["@_vDup"]);
    if (!due || amount <= 0) continue;
    out.push({
      nDup: str(d.nDup ?? d["@_nDup"]),
      dueDateYmd: due,
      amount,
    });
  }
  return out;
}
