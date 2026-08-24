import { describe, expect, it } from "vitest";
import { applyBoletoClientFilters, boletoSituationLabel } from "./fetchBoletos";
import type { BoletoReportRow } from "./fetchBoletos";
import { csvEscape, defaultReportFilters, sanitizeFilenamePart } from "./formatters";

describe("report formatters", () => {
  it("escapes CSV fields with separator and quotes", () => {
    expect(csvEscape("a;b")).toBe('"a;b"');
    expect(csvEscape('diz "oi"')).toBe('"diz ""oi"""');
    expect(csvEscape("simples")).toBe("simples");
  });

  it("sanitizes filename parts", () => {
    expect(sanitizeFilenamePart("Café & Cia")).toBe("Cafe_Cia");
  });
});

describe("boleto client filters", () => {
  const today = "2026-08-22";
  const base = {
    id: "1",
    company_id: "c",
    expense_id: null,
    description: "NF 1",
    due_date: "2026-08-10",
    amount: 100,
    barcode: null,
    provider: null,
    pix_key_type: null,
    pix_key: null,
    bank_name: null,
    bank_code: null,
    agency: null,
    account: null,
    account_type: null,
    status: "pending" as const,
    created_at: today,
    updated_at: today,
    flow_type: "payable" as const,
    entry_kind: "standard" as const,
    exclude_from_fluxo: false,
  } as BoletoReportRow;

  it("keeps overdue pending boletos", () => {
    const out = applyBoletoClientFilters(
      [base],
      {
        openDueBucket: "overdue",
        categoryId: "all",
        supplierId: "all",
        search: "",
        bankAccountId: "all",
        situation: "all",
      },
      today,
    );
    expect(out).toHaveLength(1);
    expect(boletoSituationLabel(base, today)).toBe("Vencido");
  });

  it("drops overdue when filtering upcoming", () => {
    const out = applyBoletoClientFilters(
      [base],
      {
        openDueBucket: "upcoming",
        categoryId: "all",
        supplierId: "all",
        search: "",
        bankAccountId: "all",
        situation: "all",
      },
      today,
    );
    expect(out).toHaveLength(0);
  });
});

describe("defaultReportFilters", () => {
  it("fills current month dates", () => {
    const f = defaultReportFilters();
    expect(f.dateFrom).toMatch(/^\d{4}-\d{2}-01$/);
    expect(f.dateTo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
