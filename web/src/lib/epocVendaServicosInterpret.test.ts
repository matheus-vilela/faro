import { describe, expect, it } from "vitest";
import {
  findVlBrutoColumnIndex,
  previewEpocVendaServicosInterpret,
} from "@/lib/epocVendaServicosInterpret";

const CSV = `data_consulta;secao;col_1;col_2;col_3;col_4;col_5
25/07/2026;itens_cabecalho;Código;Serviço;Quant.;Total(R$);Vl.Bruto(R$)
25/07/2026;itens;257;GORJETA;2;99,00;20,00
25/07/2026;itens;257;GORJETA;3;99,00;30,00
25/07/2026;itens;100;COUVERT;1;99,00;8,00
25/07/2026;resumo;Total Recebido;2.177,38
24/07/2026;itens;257;GORJETA;1;99,00;10,00
`;

describe("previewEpocVendaServicosInterpret", () => {
  it("usa Vl.Bruto e não a coluna Total; match por código", () => {
    const preview = previewEpocVendaServicosInterpret(CSV, "servicos.csv", [
      { id: "s1", code: "257", name: "Gorjeta", is_active: true },
    ]);

    expect(preview.ok).toBe(true);
    expect(preview.totals.validLines).toBe(4);
    expect(preview.totals.vlBruto).toBeCloseTo(68);
    expect(preview.totals.wouldMatchServices).toBe(1);
    expect(preview.totals.wouldCreateServices).toBe(1);

    const gorjeta = preview.services.find((s) => s.code === "257");
    expect(gorjeta?.catalogAction).toBe("match_service");
    expect(gorjeta?.quantity).toBe(6);
    expect(gorjeta?.vlBruto).toBeCloseTo(60);
    expect(gorjeta?.lineCount).toBe(3);

    const couvert = preview.services.find((s) => s.code === "100");
    expect(couvert?.catalogAction).toBe("create_service");
    expect(couvert?.vlBruto).toBeCloseTo(8);
  });

  it("falha sem data_consulta/secao", () => {
    const preview = previewEpocVendaServicosInterpret(
      "Código;Serviço;Vl.Bruto(R$)\n257;X;1,00\n",
      "bad.csv",
      [],
    );
    expect(preview.ok).toBe(false);
    expect(preview.error).toMatch(/data_consulta/i);
  });

  it("findVlBrutoColumnIndex", () => {
    expect(findVlBrutoColumnIndex(["Total(R$)", "Vl.Bruto(R$)"])).toBe(1);
    expect(findVlBrutoColumnIndex(["Vl. Bruto (R$)"])).toBe(0);
    expect(findVlBrutoColumnIndex(["Total(R$)"])).toBe(-1);
  });
});
