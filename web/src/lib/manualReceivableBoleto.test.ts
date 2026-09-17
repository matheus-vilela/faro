import { describe, expect, it } from "vitest";
import { isManualReceivableBoleto } from "@/lib/manualReceivableBoleto";

describe("isManualReceivableBoleto", () => {
  it("aceita título a receber sem venda e sem transferência", () => {
    expect(
      isManualReceivableBoleto({
        flow_type: "receivable",
        revenue_entry_id: null,
        entry_kind: "standard",
      }),
    ).toBe(true);
  });

  it("rejeita conta a pagar", () => {
    expect(
      isManualReceivableBoleto({
        flow_type: "payable",
        revenue_entry_id: null,
        entry_kind: "standard",
      }),
    ).toBe(false);
  });

  it("rejeita boleto gerado pela venda", () => {
    expect(
      isManualReceivableBoleto({
        flow_type: "receivable",
        revenue_entry_id: "rev-1",
        entry_kind: "standard",
      }),
    ).toBe(false);
  });

  it("rejeita transferência", () => {
    expect(
      isManualReceivableBoleto({
        flow_type: "receivable",
        revenue_entry_id: null,
        entry_kind: "transfer",
      }),
    ).toBe(false);
  });
});
