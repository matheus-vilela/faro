import { assertEquals } from "jsr:@std/assert@1/assert-equals";
import { extractXmlVnfTotal, resolveDocumentTotal, shouldCreateExpense } from "./core.ts";

Deno.test("despesa inexistente => cria", () => {
  assertEquals(shouldCreateExpense(false), true);
});

Deno.test("despesa existente ativa => não duplica", () => {
  assertEquals(shouldCreateExpense(true), false);
});

Deno.test("despesa deletada => recria (sem ativa)", () => {
  assertEquals(shouldCreateExpense(false), true);
});

Deno.test("prioriza total extraído", () => {
  const d = resolveDocumentTotal({
    extractedTotal: "123,45",
    xmlText: "<NFe><vNF>99.00</vNF></NFe>",
    summedLines: 88,
  });
  assertEquals(d, { total: 123.45, source: "extracted_total" });
});

Deno.test("usa vNF do XML quando extraído inválido", () => {
  const d = resolveDocumentTotal({
    extractedTotal: null,
    xmlText: "<NFe><vNF>321.90</vNF></NFe>",
    summedLines: 88,
  });
  assertEquals(d, { total: 321.9, source: "xml_vnf" });
});

Deno.test("usa soma de linhas quando não há total no XML", () => {
  const d = resolveDocumentTotal({
    extractedTotal: "",
    xmlText: "<NFe><infNFe></infNFe></NFe>",
    summedLines: 42.11,
  });
  assertEquals(d, { total: 42.11, source: "summed_lines" });
});

Deno.test("XML sem total válido => falha explícita", () => {
  const d = resolveDocumentTotal({
    extractedTotal: 0,
    xmlText: "<NFe><vNF>0</vNF></NFe>",
    summedLines: 0,
  });
  assertEquals(d, { total: null, source: "none" });
});

Deno.test("extractXmlVnfTotal captura maior vNF positivo", () => {
  const xml = "<root><vNF>10,00</vNF><vNF>250.15</vNF><vNF>5</vNF></root>";
  assertEquals(extractXmlVnfTotal(xml), 250.15);
});

