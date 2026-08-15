import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { aggregateVendaServicosItemRows } from "./epocPersistDailyExtras.ts";
import { findVlBrutoColumnIndex } from "./epocVendaServicosCsv.ts";

Deno.test("aggregateVendaServicosItemRows: soma Vl.Bruto, não a coluna Total", () => {
  const header = [
    "Código",
    "Serviço",
    "Quant.",
    "Vl.Unit.(R$)",
    "Total(R$)",
    "Desconto(R$)",
    "Acréscimo(R$)",
    "",
    "Rateio",
    "Vl.Bruto(R$)",
  ];
  const vlBrutoIndex = findVlBrutoColumnIndex(header);
  assertEquals(vlBrutoIndex, 9);

  const rows = [
    ["25/07/2026", "itens", "257", "GORJETA", "2", "10,00", "99,00", "1,00", "0", "", "19,00", "20,00"],
    ["25/07/2026", "itens", "257", "GORJETA", "3", "10,00", "99,00", "2,00", "0,50", "", "28,00", "30,00"],
    ["25/07/2026", "itens", "100", "COUVERT", "1", "8,00", "99,00", "0", "0", "", "8,00", "8,00"],
  ];
  const out = aggregateVendaServicosItemRows(rows, { vlBrutoIndex });
  assertEquals(out.length, 2);

  const gorjeta = out.find((s) => s.code === "257");
  assertEquals(gorjeta?.lineCount, 2);
  assertEquals(gorjeta?.quantity, 5);
  assertEquals(gorjeta?.grossValue, 50);
  assertEquals(gorjeta?.discount, 3);
  assertEquals(gorjeta?.surcharge, 0.5);
  assertEquals(gorjeta?.allocation, 47);
  assertEquals(gorjeta?.unitPrice, 10);

  const couvert = out.find((s) => s.code === "100");
  assertEquals(couvert?.lineCount, 1);
  assertEquals(couvert?.quantity, 1);
  assertEquals(couvert?.grossValue, 8);
});
