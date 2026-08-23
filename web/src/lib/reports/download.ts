import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";

import type {
  ExportFormat,
  ReportColumn,
  ReportResult,
  ReportRow,
  ReportTable,
} from "./types";
import {
  cellToString,
  csvEscape,
  formatReportDate,
  formatReportMoney,
  formatReportNumber,
} from "./formatters";

function formatCell(column: ReportColumn, value: unknown): string {
  if (column.format === "date") return formatReportDate(value);
  if (column.format === "money") return formatReportMoney(value);
  if (column.format === "number") return formatReportNumber(value);
  return cellToString(value);
}

function formattedRows(table: ReportTable): string[][] {
  return table.rows.map((row) =>
    table.columns.map((col) => formatCell(col, row[col.key])),
  );
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function buildCsv(result: ReportResult): string {
  const parts: string[] = [];
  parts.push(csvEscape(result.title));
  if (result.subtitle) parts.push(csvEscape(result.subtitle));
  for (const line of result.metaLines) {
    parts.push(csvEscape(line));
  }
  parts.push("");

  for (const table of result.tables) {
    if (result.tables.length > 1) {
      parts.push(csvEscape(table.title));
    }
    parts.push(table.columns.map((c) => csvEscape(c.header)).join(";"));
    for (const row of formattedRows(table)) {
      parts.push(row.map(csvEscape).join(";"));
    }
    parts.push("");
  }
  return `\uFEFF${parts.join("\r\n")}`;
}

function sheetName(title: string, used: Set<string>): string {
  const base = title.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Dados";
  let name = base;
  let i = 2;
  while (used.has(name)) {
    const suffix = `_${i}`;
    name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    i += 1;
  }
  used.add(name);
  return name;
}

function buildXlsx(result: ReportResult, filename: string): void {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();

  const metaRows: string[][] = [
    [result.title],
    result.subtitle ? [result.subtitle] : [],
    ...result.metaLines.map((l) => [l]),
    [],
  ].filter((r) => r.length > 0);
  if (metaRows.length) {
    const meta = XLSX.utils.aoa_to_sheet(metaRows);
    XLSX.utils.book_append_sheet(wb, meta, sheetName("Info", used));
  }

  for (const table of result.tables) {
    const aoa: unknown[][] = [
      table.columns.map((c) => c.header),
      ...formattedRows(table),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, sheetName(table.title, used));
  }

  XLSX.writeFile(wb, `${filename}.xlsx`);
}

function buildPdf(result: ReportResult, filename: string): void {
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
  });
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = 14;
  doc.setFontSize(14);
  doc.text(result.title, 14, y);
  y += 6;
  doc.setFontSize(9);
  if (result.subtitle) {
    doc.text(result.subtitle, 14, y);
    y += 5;
  }
  for (const line of result.metaLines) {
    doc.text(line, 14, y);
    y += 4.5;
  }
  y += 2;

  for (const table of result.tables) {
    autoTable(doc, {
      startY: y,
      head: [table.columns.map((c) => c.header)],
      body: formattedRows(table),
      styles: { fontSize: 8, cellPadding: 1.5 },
      headStyles: { fillColor: [30, 41, 59], textColor: 255 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 14, right: 14 },
    });
    const last = (
      doc as unknown as { lastAutoTable?: { finalY: number } }
    ).lastAutoTable;
    y = (last?.finalY ?? y) + 8;
  }

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.text(
      `${i} / ${pageCount}`,
      pageWidth - 18,
      doc.internal.pageSize.getHeight() - 8,
    );
  }

  doc.save(`${filename}.pdf`);
}

export function reportHasRows(result: ReportResult): boolean {
  return result.tables.some((t) => t.rows.length > 0);
}

export function downloadReport(
  result: ReportResult,
  format: ExportFormat,
  filename: string,
): void {
  if (format === "csv") {
    const csv = buildCsv(result);
    triggerDownload(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
      `${filename}.csv`,
    );
    return;
  }
  if (format === "xlsx") {
    buildXlsx(result, filename);
    return;
  }
  buildPdf(result, filename);
}

export function countReportRows(result: ReportResult): number {
  return result.tables.reduce((n, t) => n + t.rows.length, 0);
}

/** Used by tests — keep formatting logic in one place. */
export function formatTableRow(
  columns: ReportColumn[],
  row: ReportRow,
): string[] {
  return columns.map((col) => formatCell(col, row[col.key]));
}
