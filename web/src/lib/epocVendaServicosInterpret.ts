/**
 * Interpretação do CSV de venda de serviços EPOC
 * (`data_consulta` + `secao` itens_cabecalho/itens, valor em Vl.Bruto(R$)).
 */

export type CatalogService = {
  id: string;
  code: string;
  name: string;
  is_active?: boolean | null;
};

export type ServicoVendaSkipReason =
  | "vl_bruto_invalido"
  | "data_invalida"
  | "codigo_vazio"
  | "nome_vazio"
  | "sem_cabecalho";

export type ServicoVendaCatalogAction = "create_service" | "match_service";

export type ServicoVendaLine = {
  rowNumber: number;
  dataConsulta: string;
  dataIso: string | null;
  code: string;
  name: string;
  quantity: number | null;
  vlBruto: number | null;
  skipReason: ServicoVendaSkipReason | null;
  catalogAction: ServicoVendaCatalogAction | null;
  matchedId: string | null;
  matchedLabel: string | null;
};

export type ServicoVendaDaySummary = {
  dataIso: string;
  dataLabel: string;
  lineCount: number;
  quantity: number;
  vlBruto: number;
  uniqueServices: number;
  wouldCreate: number;
  wouldMatch: number;
};

export type ServicoVendaServiceSummary = {
  key: string;
  code: string;
  name: string;
  catalogAction: ServicoVendaCatalogAction;
  matchedId: string | null;
  matchedLabel: string | null;
  lineCount: number;
  quantity: number;
  vlBruto: number;
  days: string[];
};

export type ServicoVendasInterpretPreview = {
  ok: boolean;
  error?: string;
  fileName: string;
  headers: string[];
  columns: {
    dataConsulta: number;
    codigo: number;
    servico: number;
    quantidade: number;
    vlBruto: number;
  };
  totals: {
    rawRows: number;
    itemRows: number;
    validLines: number;
    skippedLines: number;
    uniqueServices: number;
    wouldCreateServices: number;
    wouldMatchServices: number;
    quantity: number;
    vlBruto: number;
    days: number;
  };
  days: ServicoVendaDaySummary[];
  services: ServicoVendaServiceSummary[];
  skipped: Array<{
    rowNumber: number;
    code: string;
    name: string;
    reason: ServicoVendaSkipReason;
    detail: string;
  }>;
  sampleLines: ServicoVendaLine[];
};

const COL_VL_BRUTO = "Vl.Bruto(R$)";
const SAMPLE_CAP = 80;

function normalizeHeaderLabel(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "");
}

function sanitizeCell(s: string): string {
  return String(s ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .trim();
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ";") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function parseEpocServicosCsv(text: string): {
  headers: string[];
  rows: string[][];
} {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]!).map((c) => sanitizeCell(c));
  const rows: string[][] = [];
  for (let i = 1; i < lines.length; i++) {
    rows.push(parseCsvLine(lines[i]!).map((c) => sanitizeCell(c)));
  }
  return { headers, rows };
}

export function findVlBrutoColumnIndex(headers: string[]): number {
  const want = normalizeHeaderLabel(COL_VL_BRUTO);
  for (let i = 0; i < headers.length; i++) {
    if (normalizeHeaderLabel(headers[i] ?? "") === want) return i;
  }
  for (let i = 0; i < headers.length; i++) {
    const h = normalizeHeaderLabel(headers[i] ?? "").replace(/\./g, "");
    if (h.includes("vlbruto")) return i;
  }
  return -1;
}

function findColumnIndex(headers: string[], aliases: string[]): number {
  const norm = headers.map((h) => normalizeHeaderLabel(h));
  for (const alias of aliases) {
    const j = norm.indexOf(normalizeHeaderLabel(alias));
    if (j >= 0) return j;
  }
  return -1;
}

function parseBrDateToIso(s: string): string | null {
  const t = sanitizeCell(s);
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  if (br) {
    const d = Number(br[1]);
    const m = Number(br[2]);
    const y = Number(br[3]);
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

function isoToBr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function parseBrMoney(s: string): number | null {
  const t = sanitizeCell(s)
    .replace(/R\$\s?/gi, "")
    .replace(/\./g, "")
    .replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function parseBrQuantity(s: string): number | null {
  const t = sanitizeCell(s).replace(/\./g, "").replace(",", ".");
  if (!t) return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function resolveCatalogAction(
  code: string,
  services: CatalogService[],
): Pick<ServicoVendaLine, "catalogAction" | "matchedId" | "matchedLabel"> {
  const key = sanitizeCell(code);
  const hits = services.filter(
    (s) => s.is_active !== false && sanitizeCell(s.code) === key,
  );
  if (hits.length >= 1) {
    const s = hits[0]!;
    return {
      catalogAction: "match_service",
      matchedId: s.id,
      matchedLabel: `${s.name} (${s.code})`,
    };
  }
  return {
    catalogAction: "create_service",
    matchedId: null,
    matchedLabel: null,
  };
}

function emptyPreview(
  fileName: string,
  headers: string[],
  error?: string,
  rawRows = 0,
): ServicoVendasInterpretPreview {
  return {
    ok: !error,
    error,
    fileName,
    headers,
    columns: {
      dataConsulta: -1,
      codigo: -1,
      servico: -1,
      quantidade: -1,
      vlBruto: -1,
    },
    totals: {
      rawRows,
      itemRows: 0,
      validLines: 0,
      skippedLines: 0,
      uniqueServices: 0,
      wouldCreateServices: 0,
      wouldMatchServices: 0,
      quantity: 0,
      vlBruto: 0,
      days: 0,
    },
    days: [],
    services: [],
    skipped: [],
    sampleLines: [],
  };
}

export function previewEpocVendaServicosInterpret(
  csvText: string,
  fileName: string,
  services: CatalogService[],
): ServicoVendasInterpretPreview {
  const { headers, rows } = parseEpocServicosCsv(csvText);
  if (headers.length === 0) {
    return emptyPreview(fileName, [], "CSV vazio ou sem cabeçalho.");
  }

  const normHeaders = headers.map(normalizeHeaderLabel);
  const dataCol = normHeaders.indexOf(normalizeHeaderLabel("data_consulta"));
  const secaoCol = normHeaders.indexOf(normalizeHeaderLabel("secao"));

  if (dataCol < 0 || secaoCol < 0) {
    return emptyPreview(
      fileName,
      headers,
      'CSV de serviços precisa das colunas "data_consulta" e "secao" (export EPOC).',
      rows.length,
    );
  }

  let tableHeader: string[] = [];
  let codigoCol = -1;
  let servicoCol = -1;
  let quantCol = -1;
  let vlBrutoCol = -1;

  const applyTableHeader = (cols: string[]) => {
    tableHeader = cols;
    codigoCol = findColumnIndex(cols, ["Código", "Codigo", "Cód.", "Cod."]);
    servicoCol = findColumnIndex(cols, ["Serviço", "Servico"]);
    quantCol = findColumnIndex(cols, [
      "Quant.",
      "Quant",
      "Quantidade",
      "Qtd.",
      "Qtde",
    ]);
    vlBrutoCol = findVlBrutoColumnIndex(cols);
  };

  const validLines: ServicoVendaLine[] = [];
  const skipped: ServicoVendasInterpretPreview["skipped"] = [];
  let itemRows = 0;
  let sawCabecalho = false;

  rows.forEach((row, idx) => {
    const rowNumber = idx + 2;
    const secao = sanitizeCell(row[secaoCol] ?? "").toLowerCase();
    const tableCols = row.slice(secaoCol + 1);

    if (secao === "itens_cabecalho") {
      sawCabecalho = true;
      applyTableHeader(tableCols);
      return;
    }
    if (secao !== "itens") return;

    itemRows += 1;
    const dataRaw = sanitizeCell(row[dataCol] ?? "");
    const dataIso = parseBrDateToIso(dataRaw);

    if (!sawCabecalho || vlBrutoCol < 0) {
      skipped.push({
        rowNumber,
        code: "",
        name: "",
        reason: "sem_cabecalho",
        detail: `Coluna "${COL_VL_BRUTO}" ausente no itens_cabecalho.`,
      });
      return;
    }

    const code =
      codigoCol >= 0 ? sanitizeCell(tableCols[codigoCol] ?? "") : "";
    const name =
      servicoCol >= 0 ? sanitizeCell(tableCols[servicoCol] ?? "") : "";
    const quantity =
      quantCol >= 0 ? parseBrQuantity(tableCols[quantCol] ?? "") : 0;
    const vlBruto = parseBrMoney(tableCols[vlBrutoCol] ?? "");

    if (!dataIso) {
      skipped.push({
        rowNumber,
        code,
        name,
        reason: "data_invalida",
        detail: dataRaw || "data vazia",
      });
      return;
    }
    if (!code) {
      skipped.push({
        rowNumber,
        code,
        name,
        reason: "codigo_vazio",
        detail: "sem código",
      });
      return;
    }
    if (!name) {
      skipped.push({
        rowNumber,
        code,
        name,
        reason: "nome_vazio",
        detail: "sem nome de serviço",
      });
      return;
    }
    if (vlBruto == null) {
      skipped.push({
        rowNumber,
        code,
        name,
        reason: "vl_bruto_invalido",
        detail: tableCols[vlBrutoCol] ?? "",
      });
      return;
    }

    const catalog = resolveCatalogAction(code, services);
    validLines.push({
      rowNumber,
      dataConsulta: dataRaw,
      dataIso,
      code,
      name,
      quantity,
      vlBruto,
      skipReason: null,
      ...catalog,
    });
  });

  if (itemRows === 0) {
    return {
      ...emptyPreview(
        fileName,
        tableHeader.length > 0 ? tableHeader : headers,
        'Nenhuma linha de seção "itens" no CSV.',
        rows.length,
      ),
      columns: {
        dataConsulta: dataCol,
        codigo: codigoCol,
        servico: servicoCol,
        quantidade: quantCol,
        vlBruto: vlBrutoCol,
      },
    };
  }

  if (!sawCabecalho || vlBrutoCol < 0) {
    return {
      ...emptyPreview(
        fileName,
        headers,
        `Coluna "${COL_VL_BRUTO}" não encontrada no itens_cabecalho.`,
        rows.length,
      ),
      totals: {
        ...emptyPreview(fileName, headers).totals,
        rawRows: rows.length,
        itemRows,
        skippedLines: skipped.length,
      },
      skipped,
    };
  }

  const dayMap = new Map<string, ServicoVendaDaySummary>();
  const serviceMap = new Map<string, ServicoVendaServiceSummary>();

  for (const line of validLines) {
    const iso = line.dataIso!;
    const qty = line.quantity ?? 0;
    const bruto = line.vlBruto ?? 0;
    const action = line.catalogAction ?? "create_service";

    const day = dayMap.get(iso) ?? {
      dataIso: iso,
      dataLabel: isoToBr(iso),
      lineCount: 0,
      quantity: 0,
      vlBruto: 0,
      uniqueServices: 0,
      wouldCreate: 0,
      wouldMatch: 0,
    };
    day.lineCount += 1;
    day.quantity += qty;
    day.vlBruto += bruto;
    dayMap.set(iso, day);

    const prev = serviceMap.get(line.code);
    if (!prev) {
      serviceMap.set(line.code, {
        key: line.code,
        code: line.code,
        name: line.name,
        catalogAction: action,
        matchedId: line.matchedId,
        matchedLabel: line.matchedLabel,
        lineCount: 1,
        quantity: qty,
        vlBruto: bruto,
        days: [iso],
      });
    } else {
      prev.lineCount += 1;
      prev.quantity += qty;
      prev.vlBruto += bruto;
      if (!prev.days.includes(iso)) prev.days.push(iso);
    }
  }

  for (const day of dayMap.values()) {
    const codes = new Set(
      validLines.filter((l) => l.dataIso === day.dataIso).map((l) => l.code),
    );
    day.uniqueServices = codes.size;
    day.wouldCreate = [...codes].filter((c) => {
      const s = serviceMap.get(c);
      return s?.catalogAction === "create_service";
    }).length;
    day.wouldMatch = [...codes].filter((c) => {
      const s = serviceMap.get(c);
      return s?.catalogAction === "match_service";
    }).length;
  }

  const days = [...dayMap.values()].sort((a, b) =>
    b.dataIso.localeCompare(a.dataIso),
  );
  const serviceList = [...serviceMap.values()].sort(
    (a, b) => b.vlBruto - a.vlBruto,
  );

  return {
    ok: true,
    fileName,
    headers: tableHeader,
    columns: {
      dataConsulta: dataCol,
      codigo: codigoCol,
      servico: servicoCol,
      quantidade: quantCol,
      vlBruto: vlBrutoCol,
    },
    totals: {
      rawRows: rows.length,
      itemRows,
      validLines: validLines.length,
      skippedLines: skipped.length,
      uniqueServices: serviceList.length,
      wouldCreateServices: serviceList.filter(
        (s) => s.catalogAction === "create_service",
      ).length,
      wouldMatchServices: serviceList.filter(
        (s) => s.catalogAction === "match_service",
      ).length,
      quantity: validLines.reduce((acc, l) => acc + (l.quantity ?? 0), 0),
      vlBruto: validLines.reduce((acc, l) => acc + (l.vlBruto ?? 0), 0),
      days: days.length,
    },
    days,
    services: serviceList,
    skipped,
    sampleLines: validLines.slice(0, SAMPLE_CAP),
  };
}

export function catalogActionLabel(action: ServicoVendaCatalogAction): string {
  if (action === "match_service") return "Serviço existente";
  return "Criar serviço";
}

export function skipReasonLabel(reason: ServicoVendaSkipReason): string {
  switch (reason) {
    case "vl_bruto_invalido":
      return "Vl.Bruto inválido";
    case "data_invalida":
      return "Data inválida";
    case "codigo_vazio":
      return "Código vazio";
    case "nome_vazio":
      return "Serviço vazio";
    case "sem_cabecalho":
      return "Cabeçalho sem Vl.Bruto";
  }
}
