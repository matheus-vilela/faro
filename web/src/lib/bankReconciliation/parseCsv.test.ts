import { describe, expect, it } from "vitest";
import { detectBtgCsvPreset, parseBrOrUsAmount, parseCsv, parseCsvDate } from "./parseCsv";

const SAMPLE_CSV = `"Data","Descricao","Valor","Saldo"
"19/07/2026","Valor de Rendimento Remunera+","0,49","115.003,68"
"08/07/2026","TED IMOBILIARIA CENTRO","-3.500,00","111.503,68"
"05/07/2026","TARIFA PACOTE MENSAL","-79,00","111.424,68"
`;

describe("parseCsv", () => {
  it("parseia datas e valores BR", () => {
    expect(parseCsvDate("19/07/2026")).toBe("2026-07-19");
    expect(parseBrOrUsAmount("0,49")).toBe(0.49);
    expect(parseBrOrUsAmount("-3.500,00")).toBe(-3500);
    expect(parseBrOrUsAmount("115.003,68")).toBe(115003.68);
  });

  it("detecta preset BTG e importa débitos/créditos", () => {
    const { transactions, headers, mapping } = parseCsv(SAMPLE_CSV);
    expect(detectBtgCsvPreset(headers)).not.toBeNull();
    expect(mapping.date).toBe("Data");
    expect(transactions).toHaveLength(3);

    const debit = transactions.find((t) => t.description.includes("IMOBILIARIA"));
    expect(debit?.direction).toBe("debit");
    expect(debit?.amount).toBe(3500);
    expect(debit?.postedAt).toBe("2026-07-08");

    const credit = transactions.find((t) => t.description.includes("Rendimento"));
    expect(credit?.direction).toBe("credit");
    expect(credit?.amount).toBe(0.49);
  });
});
