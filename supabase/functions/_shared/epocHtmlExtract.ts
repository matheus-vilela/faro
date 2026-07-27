/**
 * Extração de nós HTML por `id` e tabelas (mesmo critério que epoc-sync-csv).
 */

const VOID_HTML = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

export function unwrapAcoesHtml(text: string): string {
  const t = text.replace(/^\uFEFF/, "").trim();
  if (!t.startsWith("{")) return t;
  try {
    const j = JSON.parse(t) as Record<string, unknown>;
    for (const k of ["conteudo", "html", "dados", "tela_html"]) {
      if (typeof j[k] === "string" && (j[k] as string).length > 0) {
        return j[k] as string;
      }
    }
  } catch {
    /* manter texto */
  }
  return t;
}

export function idAttributeInMarkupRegex(elementId: string): RegExp {
  const e = elementId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `\\bid\\s*=\\s*["']${e}["']|\\bid\\s*=\\s*${e}(?=[\\s/>])`,
    "i",
  );
}

export function htmlHasId(html: string, elementId: string): boolean {
  return idAttributeInMarkupRegex(elementId).test(html);
}

function endOfStartTagIndex(html: string, lt: number): number {
  if (html[lt] !== "<") return -1;
  let inQuote: '"' | "'" | null = null;
  for (let i = lt + 1; i < html.length; i++) {
    const c = html[i];
    if (inQuote) {
      if (c === inQuote) inQuote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inQuote = c;
      continue;
    }
    if (c === ">") return i;
  }
  return -1;
}

/** Outer HTML do nó com o `id` indicado. */
export function extractElementOuterHtmlById(
  html: string,
  elementId: string,
): string | null {
  if (!htmlHasId(html, elementId)) return null;
  const reId = new RegExp(idAttributeInMarkupRegex(elementId).source, "gi");
  const inTag = idAttributeInMarkupRegex(elementId);
  let m: RegExpExecArray | null;
  const maxIdDistance = 10_000;
  while ((m = reId.exec(html)) !== null) {
    const idIdx = m.index;
    const openStart = html.lastIndexOf("<", idIdx);
    if (openStart < 0 || idIdx - openStart > maxIdDistance) continue;
    if (html.slice(openStart, openStart + 4) === "<!--") continue;
    const tagHeadEnd = endOfStartTagIndex(html, openStart);
    if (tagHeadEnd < 0) continue;
    if (idIdx < openStart || idIdx + m[0].length > tagHeadEnd) continue;
    const openTag = html.slice(openStart, tagHeadEnd + 1);
    inTag.lastIndex = 0;
    if (!inTag.test(openTag)) continue;
    const nameMatch = /^<\s*([a-zA-Z][\w:-]*)\b/i.exec(openTag);
    if (!nameMatch) continue;
    const tagName = (nameMatch[1] ?? "").toLowerCase();
    if (VOID_HTML.has(tagName)) return openTag;
    const tagEsc = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const reOpen = new RegExp(`<\\s*${tagEsc}\\b`, "i");
    const reClose = new RegExp(`<\\/\\s*${tagEsc}\\s*>`, "i");
    const start = openStart;
    let i = tagHeadEnd + 1;
    let depth = 1;
    const h = html;
    while (i < h.length && depth > 0) {
      const rest = h.slice(i);
      const nextOpen = rest.search(reOpen);
      const nextCloseM = reClose.exec(rest);
      if (!nextCloseM) break;
      const nextClose = nextCloseM.index;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth += 1;
        i += nextOpen;
        const gt = h.indexOf(">", i);
        if (gt === -1) break;
        i = gt + 1;
      } else {
        const closePos = i + nextClose;
        const len = nextCloseM[0].length;
        depth -= 1;
        if (depth === 0) {
          return h.slice(start, closePos + len);
        }
        i = closePos + len;
      }
    }
  }
  return null;
}

/** Extrai o outer HTML da `<table>` que começa em `openStart`. */
export function extractTableOuterHtmlAt(
  html: string,
  openStart: number,
): string | null {
  if (html[openStart] !== "<") return null;
  const tagHeadEnd = endOfStartTagIndex(html, openStart);
  if (tagHeadEnd < 0) return null;
  const openTag = html.slice(openStart, tagHeadEnd + 1);
  if (!/^<\s*table\b/i.test(openTag)) return null;
  const reOpen = /<\s*table\b/i;
  const reClose = /<\/\s*table\s*>/i;
  let i = tagHeadEnd + 1;
  let depth = 1;
  while (i < html.length && depth > 0) {
    const rest = html.slice(i);
    const nextOpen = rest.search(reOpen);
    const nextCloseM = reClose.exec(rest);
    if (!nextCloseM) break;
    const nextClose = nextCloseM.index;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      i += nextOpen;
      const gt = html.indexOf(">", i);
      if (gt === -1) break;
      i = gt + 1;
    } else {
      const closePos = i + nextClose;
      const len = nextCloseM[0].length;
      depth -= 1;
      if (depth === 0) return html.slice(openStart, closePos + len);
      i = closePos + len;
    }
  }
  return null;
}

export type TopLevelTableSlice = {
  start: number;
  end: number;
  html: string;
};

/** Tabelas de topo (não aninhadas) dentro de um fragmento HTML. */
export function extractTopLevelTables(containerHtml: string): TopLevelTableSlice[] {
  const out: TopLevelTableSlice[] = [];
  const re = /<\s*table\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(containerHtml)) !== null) {
    const start = m.index;
    if (out.some((t) => start > t.start && start < t.end)) continue;
    const tableHtml = extractTableOuterHtmlAt(containerHtml, start);
    if (!tableHtml) continue;
    out.push({ start, end: start + tableHtml.length, html: tableHtml });
    re.lastIndex = start + tableHtml.length;
  }
  return out;
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    );
}

export function normalizeCellText(cellHtml: string): string {
  const noScripts = cellHtml
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "");
  const withBreaks = noScripts.replace(/<br\s*\/?>/gi, "\n");
  const plain = withBreaks.replace(/<[^>]+>/g, " ");
  return decodeHtmlEntities(plain).replace(/\s+/g, " ").trim();
}

export function extractTableRows(tableHtml: string): string[][] {
  const rows: string[][] = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let trM: RegExpExecArray | null;
  while ((trM = trRe.exec(tableHtml)) !== null) {
    const rowInner = trM[1] ?? "";
    const cols: string[] = [];
    const cellRe = /<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi;
    let cM: RegExpExecArray | null;
    while ((cM = cellRe.exec(rowInner)) !== null) {
      cols.push(normalizeCellText(cM[1] ?? ""));
    }
    if (cols.length > 0) rows.push(cols);
  }
  return rows;
}

export function csvEscapeCell(v: string): string {
  const s = v.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const needsQuote = /[",;\n]/.test(s);
  const esc = s.replace(/"/g, '""');
  return needsQuote ? `"${esc}"` : esc;
}

export function matrixToCsv(header: string[], rows: string[][]): string {
  const lines: string[] = [];
  lines.push(header.map(csvEscapeCell).join(";"));
  for (const row of rows) {
    lines.push(row.map(csvEscapeCell).join(";"));
  }
  return `${lines.join("\n")}\n`;
}
