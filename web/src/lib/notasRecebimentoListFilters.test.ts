import { describe, expect, it } from "vitest";
import {
  expenseHasUnlinkedProduct,
  expenseHasValueRisk,
  expenseParticipatesInNotasRecebimento,
  filterIdsByBoleto,
  filterIdsByRecebimento,
  filterIdsByRecebimentoSection,
  filterIdsParticipatingInNotasRecebimento,
  parseRecebimentoListSection,
  parseRecebimentoListTab,
  recebimentoKindFromRow,
} from "./notasRecebimentoListFilters";

describe("recebimentoKindFromRow", () => {
  it("classifies pending, confirmed and pending receipt", () => {
    expect(
      recebimentoKindFromRow({ status: "pending", itemStatuses: [] }),
    ).toBe("pending");
    expect(
      recebimentoKindFromRow({
        status: "received",
        itemStatuses: [{ status: "received" }],
      }),
    ).toBe("confirmed");
    expect(
      recebimentoKindFromRow({
        status: "received",
        itemStatuses: [{ status: "partial" }],
      }),
    ).toBe("pending_receipt");
  });
});

describe("filterIdsByRecebimento / boleto", () => {
  it("keeps expenses without recebimento when filter is none", () => {
    const kinds = new Map([
      ["a", "pending" as const],
    ]);
    expect(filterIdsByRecebimento(["a", "b"], kinds, "none")).toEqual(["b"]);
  });

  it("splits divergence, awaiting and received lists", () => {
    const kinds = new Map([
      ["a", "pending" as const],
      ["b", "confirmed" as const],
      ["c", "pending_receipt" as const],
    ]);
    expect(
      filterIdsByRecebimentoSection(["a", "b", "c", "d"], kinds, "divergence"),
    ).toEqual(["c"]);
    expect(
      filterIdsByRecebimentoSection(["a", "b", "c", "d"], kinds, "awaiting"),
    ).toEqual(["a", "d"]);
    expect(
      filterIdsByRecebimentoSection(["a", "b", "c", "d"], kinds, "received"),
    ).toEqual(["b"]);
  });

  it("keeps merchandise without card and drops finance recibos", () => {
    expect(
      expenseParticipatesInNotasRecebimento("nota_fiscal", "none"),
    ).toBe(true);
    expect(expenseParticipatesInNotasRecebimento("romaneio", "none")).toBe(
      true,
    );
    expect(expenseParticipatesInNotasRecebimento("recibo", "none")).toBe(
      false,
    );
    expect(expenseParticipatesInNotasRecebimento("recibo", "pending")).toBe(
      true,
    );
    const types = new Map([
      ["nf", "nota_fiscal"],
      ["fin", "recibo"],
      ["opted", "recibo"],
    ]);
    const kinds = new Map([
      ["opted", "pending" as const],
    ]);
    expect(
      filterIdsParticipatingInNotasRecebimento(
        ["nf", "fin", "opted"],
        types,
        kinds,
      ),
    ).toEqual(["nf", "opted"]);
  });

  it("parses list section from query", () => {
    expect(parseRecebimentoListTab("received")).toBe("received");
    expect(parseRecebimentoListTab("awaiting")).toBe("awaiting");
    expect(parseRecebimentoListTab("divergence")).toBe("divergence");
    expect(parseRecebimentoListTab(null)).toBe("awaiting");
    expect(parseRecebimentoListSection(null)).toBeNull();
    expect(parseRecebimentoListSection("divergence")).toBe("divergence");
  });

  it("splits boleto linked vs unlinked", () => {
    const withBoleto = new Set(["a"]);
    expect(filterIdsByBoleto(["a", "b"], withBoleto, "with")).toEqual(["a"]);
    expect(filterIdsByBoleto(["a", "b"], withBoleto, "without")).toEqual(["b"]);
  });
});

describe("attention helpers", () => {
  it("detects unlinked product lines", () => {
    expect(
      expenseHasUnlinkedProduct([{ product_id: "p1" }, { product_id: null }]),
    ).toBe(true);
    expect(expenseHasUnlinkedProduct([{ product_id: "p1" }])).toBe(false);
  });

  it("ignores category rateio stubs", () => {
    expect(
      expenseHasUnlinkedProduct([
        { product_id: null, company_category_id: "cat-a" },
        { product_id: null, company_category_id: "cat-b" },
      ]),
    ).toBe(false);
  });

  it("flags value risk without icms_tot when totals diverge", () => {
    expect(
      expenseHasValueRisk({
        documentTotal: 1850,
        items: [{ quantity: 1, unit_value: 100 }],
        financialReconciliationJson: null,
      }),
    ).toBe(true);
    expect(
      expenseHasValueRisk({
        documentTotal: 100,
        items: [{ quantity: 1, unit_value: 100 }],
        financialReconciliationJson: { icms_tot: { vNF: 100 } },
      }),
    ).toBe(false);
  });
});
