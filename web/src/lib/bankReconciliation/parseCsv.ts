import type {
  BankCsvColumnMapping,
  BankStatementLineDirection,
  ParsedBankTransaction,
} from "@/types/bankReconciliation";
import { BTG_CSV_PRESET } from "@/types/bankReconciliation";

function stripBom(s: string): string {
  return s.replace(/^\uFEFF/, "");
}

/** Parse valor BR (1.234,56) ou US (1,234.56 / 1234.56). */
export function parseBrOrUsAmount(raw: string): number | null {
  let s = raw.trim().replace(/^["']|["']$/g, "").replace(/\s/g, "");
  if (!s) return null;
  const negative = s.startsWith("-") || s.startsWith("(");
  s = s.replace(/^[-(]+|[)]+$/g, "");
  if (s.includes(",") && s.includes(".")) {
    // BR: 1.234,56
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  const abs = Math.round(Math.abs(n) * 100) / 100;
  return negative ? -abs : abs;
}

/** DD/MM/YYYY ou YYYY-MM-DD → YYYY-MM-DD */
export function parseCsvDate(raw: string): string | null {
  const s = raw.trim().replace(/^["']|["']$/g, "");
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) {
    const d = br[1].padStart(2, "0");
    const m = br[2].padStart(2, "0");
    return `${br[3]}-${m}-${d}`;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === "," || ch === ";") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

export function detectBtgCsvPreset(headers: string[]): BankCsvColumnMapping | null {
  const norm = headers.map((h) => h.replace(/^["']|["']$/g, "").trim().toLowerCase());
  const hasData = norm.includes("data");
  const hasDesc =
    norm.includes("descricao") || norm.includes("descrição");
  const hasValor = norm.includes("valor");
  if (hasData && hasDesc && hasValor) return { ...BTG_CSV_PRESET };
  return null;
}

function colIndex(headers: string[], name: string): number {
  const target = name.trim().toLowerCase();
  return headers.findIndex(
    (h) => h.replace(/^["']|["']$/g, "").trim().toLowerCase() === target,
  );
}

function directionFromSigned(
  signed: number,
  directionCell: string | undefined,
): BankStatementLineDirection {
  if (directionCell) {
    const d = directionCell.trim().toLowerCase();
    if (
      d === "d" ||
      d === "debit" ||
      d === "débito" ||
      d === "debito" ||
      d === "saída" ||
      d === "saida"
    ) {
      return "debit";
    }
    if (
      d === "c" ||
      d === "credit" ||
      d === "crédito" ||
      d === "credito" ||
      d === "entrada"
    ) {
      return "credit";
    }
  }
  return signed < 0 ? "debit" : "credit";
}

export function parseCsv(
  content: string,
  mapping?: BankCsvColumnMapping | null,
): { transactions: ParsedBankTransaction[]; headers: string[]; mapping: BankCsvColumnMapping } {
  const text = stripBom(content);
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return {
      transactions: [],
      headers: [],
      mapping: mapping ?? BTG_CSV_PRESET,
    };
  }

  const headers = parseCsvLine(lines[0]);
  const resolved =
    mapping ?? detectBtgCsvPreset(headers) ?? BTG_CSV_PRESET;

  const iDate = colIndex(headers, resolved.date);
  const iDesc = colIndex(headers, resolved.description);
  const iAmt = colIndex(headers, resolved.amount);
  const iDir = resolved.direction
    ? colIndex(headers, resolved.direction)
    : -1;

  if (iDate < 0 || iDesc < 0 || iAmt < 0) {
    return { transactions: [], headers, mapping: resolved };
  }

  const transactions: ParsedBankTransaction[] = [];
  for (let r = 1; r < lines.length; r++) {
    const cols = parseCsvLine(lines[r]);
    const postedAt = parseCsvDate(cols[iDate] ?? "");
    const signed = parseBrOrUsAmount(cols[iAmt] ?? "");
    if (!postedAt || signed === null || signed === 0) continue;

    const description = (cols[iDesc] ?? "").replace(/^["']|["']$/g, "");
    const dirCell = iDir >= 0 ? cols[iDir] : undefined;

    transactions.push({
      postedAt,
      amount: Math.abs(signed),
      direction: directionFromSigned(signed, dirCell),
      description,
      fitid: null,
      raw: { row: cols, headers },
    });
  }

  return { transactions, headers, mapping: resolved };
}
