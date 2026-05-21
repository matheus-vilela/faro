import { assertEquals } from "jsr:@std/assert@1";
import { parseNfeXmlForUnifiedCatalog } from "./parseNfeXml.ts";
import { computeEffectiveUnitPricesForCatalogLines } from "./nfeEffectiveUnitPrice.ts";
import {
  mergeMinMaxPrice,
  observedUnitPriceFromNfeLine,
  unitPriceFromNfeLine,
} from "./unifiedSupplierCatalogFromNfeXml.ts";

Deno.test("unitPriceFromNfeLine: usa vUnCom", () => {
  assertEquals(unitPriceFromNfeLine(12.5, 2, 25), 12.5);
});

Deno.test("unitPriceFromNfeLine: deriva de vProd/qCom", () => {
  assertEquals(unitPriceFromNfeLine(null, 4, 20), 5);
});

Deno.test("mergeMinMaxPrice: expande faixa", () => {
  assertEquals(mergeMinMaxPrice(8, 10, 15), { min_price: 8, max_price: 15 });
  assertEquals(mergeMinMaxPrice(20, 10, 15), { min_price: 10, max_price: 20 });
  assertEquals(mergeMinMaxPrice(12, null, null), {
    min_price: 12,
    max_price: 12,
  });
});

const baseEmit =
  "<emit><CNPJ>61186888000193</CNPJ><xNome>SPAL INDUSTRIA</xNome><xFant>SPAL</xFant></emit>";
const baseIde =
  "<ide><nNF>1</nNF><serie>1</serie></ide>";
const baseTotal = "<total><ICMSTot><vNF>10</vNF></ICMSTot></total>";

Deno.test("parseNfeXmlForUnifiedCatalog: prod completo e cProd", () => {
  const xml =
    `<nfeProc><NFe><infNFe Id="NFe35260561186888000193550160166097831008206180">` +
    baseEmit +
    baseIde +
    "<det nItem=\"1\"><prod><cProd>ABC</cProd><xProd>Refrigerante</xProd>" +
    "<NCM>22021000</NCM><cEAN>7891234567890</cEAN><qCom>2</qCom><vUnCom>5</vUnCom>" +
    "<vProd>10</vProd><uCom>CX</uCom></prod></det>" +
    baseTotal +
    `</infNFe></NFe></nfeProc>`;
  const r = parseNfeXmlForUnifiedCatalog(xml);
  assertEquals(r != null, true);
  assertEquals(r!.lines.length, 1);
  assertEquals(String(r!.lines[0]!.prod.cProd), "ABC");
  assertEquals(r!.emit.supplierDocument, "61186888000193");
  assertEquals(r!.emit.fantasyName, "SPAL");
});

Deno.test("observedUnitPriceFromNfeLine: desconto na linha (não vUnCom bruto)", () => {
  const xml =
    `<nfeProc><NFe><infNFe>` +
    baseEmit +
    baseIde +
    "<det><prod><cProd>A</cProd><xProd>Item</xProd><qCom>10</qCom>" +
    "<vUnCom>10</vUnCom><vProd>100</vProd><vDesc>10</vDesc></prod></det>" +
    baseTotal +
    `</infNFe></NFe></nfeProc>`;
  const parsed = parseNfeXmlForUnifiedCatalog(xml)!;
  const prices = computeEffectiveUnitPricesForCatalogLines(parsed.lines, xml);
  const prod = parsed.lines[0]!.prod;
  assertEquals(observedUnitPriceFromNfeLine(prices[0]!.effectiveUnitPrice, prod), 9);
  assertEquals(unitPriceFromNfeLine(10, 10, 100), 10);
});

Deno.test("parseNfeXmlForUnifiedCatalog: ignora det sem cProd", () => {
  const xml =
    `<nfeProc><NFe><infNFe Id="NFe3526">` +
    baseEmit +
    baseIde +
    "<det><prod><xProd>Sem codigo</xProd><qCom>1</qCom><vUnCom>1</vUnCom><vProd>1</vProd></prod></det>" +
    baseTotal +
    `</infNFe></NFe></nfeProc>`;
  const r = parseNfeXmlForUnifiedCatalog(xml);
  assertEquals(r, null);
});
