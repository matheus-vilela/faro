import { assertEquals } from "jsr:@std/assert@1/assert-equals";
import {
  extractIcmsTotalsFromNfeXml,
  reconcileNfeFinancials,
} from "./financialReconciliation.ts";
import type { ExtractedExpenseItem } from "../openaiExpense.ts";

Deno.test("extractIcmsTotalsFromNfeXml lê frete/desconto/outros", () => {
  const xml =
    `<nfeProc><NFe><infNFe><total><ICMSTot>` +
    `<vNF>110.00</vNF><vFrete>10.50</vFrete>` +
    `<vDesc>1.50</vDesc><vOutro>0.75</vOutro>` +
    `</ICMSTot></total></infNFe></NFe></nfeProc>`;
  const t = extractIcmsTotalsFromNfeXml(xml)!;
  assertEquals(t.vNF, 110);
  assertEquals(t.vFrete, 10.5);
  assertEquals(t.vDesc, 1.5);
  assertEquals(t.vOutro, 0.75);
});

Deno.test("reconcileNfeFinancials OK quando vNF casa com linhas+componentes", () => {
  const items: ExtractedExpenseItem[] = [
    {
      productName: "a",
      quantity: 2,
      unitValue: 50,
      lineTotal: 100,
    },
  ];
  const xml =
    `<nfeProc><NFe><infNFe><det><prod><xProd>x</xProd><qCom>1</qCom><vUnCom>1</vUnCom><vProd>100</vProd></prod></det>` +
    `<total><ICMSTot><vNF>110</vNF><vFrete>10</vFrete>` +
    `<vDesc>0</vDesc></ICMSTot></total></infNFe></NFe></nfeProc>`;
  const r = reconcileNfeFinancials({
    items,
    expenseDocumentTotal: 110,
    xmlText: xml,
  });
  assertEquals(r.status, "OK");
  assertEquals(r.document_total, 110);
  assertEquals(r.sum_lines, 100);
});
