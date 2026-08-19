import { describe, expect, it } from "vitest";
import { pickLaunchMemoryFromHistory } from "./suggestLaunchFromHistory";
import type { HistoryLaunchRow } from "./suggestLaunchFromHistory";

function row(
  bankDescription: string,
  overrides: Partial<HistoryLaunchRow["boleto"]> & {
    counterpart?: HistoryLaunchRow["counterpart"];
  } = {},
): HistoryLaunchRow {
  const { counterpart, ...boleto } = overrides;
  return {
    bankDescription,
    boleto: {
      description: "Rendimento CDB",
      flow_type: "receivable",
      entry_kind: "standard",
      company_category_id: "cat-rend",
      company_bank_account_id: "acc-1",
      transfer_group_id: null,
      ...boleto,
    },
    counterpart: counterpart ?? null,
  };
}

describe("pickLaunchMemoryFromHistory", () => {
  it("usa o lançamento mais recente com a mesma descrição normalizada", () => {
    const suggestion = pickLaunchMemoryFromHistory(
      "VALOR DE RENDIMENTO 998877",
      [
        row("Valor de Rendimento 112233", {
          company_category_id: "cat-nova",
          description: "Rendimento aplicações",
        }),
        row("Valor de Rendimento 000111", {
          company_category_id: "cat-antiga",
        }),
      ],
    );
    expect(suggestion?.companyCategoryId).toBe("cat-nova");
    expect(suggestion?.description).toBe("Rendimento aplicações");
    expect(suggestion?.flowType).toBe("receivable");
  });

  it("prefere transferência quando pedido", () => {
    const suggestion = pickLaunchMemoryFromHistory(
      "TED ENTRE CONTAS 55566677788",
      [
        row("TED ENTRE CONTAS 111", {
          flow_type: "payable",
          entry_kind: "standard",
          company_category_id: "cat-desp",
          description: "Pagamento",
        }),
        row("TED ENTRE CONTAS 222", {
          flow_type: "payable",
          entry_kind: "transfer",
          company_category_id: null,
          company_bank_account_id: "origem",
          description: "Transferência caixa",
          counterpart: {
            flow_type: "receivable",
            company_bank_account_id: "destino",
          },
        }),
      ],
      { entryKind: "transfer" },
    );
    expect(suggestion?.entryKind).toBe("transfer");
    expect(suggestion?.originBankAccountId).toBe("origem");
    expect(suggestion?.destBankAccountId).toBe("destino");
  });

  it("retorna null se a descrição for curta ou inédita", () => {
    expect(pickLaunchMemoryFromHistory("PIX", [row("PIX 12345")])).toBeNull();
    expect(
      pickLaunchMemoryFromHistory("TARIFA PACOTE MENSAL", [
        row("Valor de Rendimento"),
      ]),
    ).toBeNull();
  });
});
