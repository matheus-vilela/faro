import { describe, expect, it } from "vitest";
import {
  expenseHasUnlinkedProduct,
  expenseHasValueRisk,
  filterIdsByBoleto,
  filterIdsByRecebimento,
  filterIdsByRecebimentoSection,
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
