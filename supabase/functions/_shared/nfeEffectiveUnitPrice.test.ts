import { assertEquals } from "jsr:@std/assert@1";
import { parseNfeXmlForUnifiedCatalog } from "./parseNfeXml.ts";
import { computeEffectiveUnitPricesForCatalogLines } from "./nfeEffectiveUnitPrice.ts";

const baseEmit =
  "<emit><CNPJ>61186888000193</CNPJ><xNome>FORN</xNome></emit>";
const baseIde = "<ide><nNF>1</nNF><serie>1</serie></ide>";

Deno.test("preço efetivo: desconto na linha reduz unitário", () => {
  const xml =
    `<nfeProc><NFe><infNFe>` +
    baseEmit +
    baseIde +
    "<det><prod><cProd>A</cProd><xProd>Item</xProd><qCom>10</qCom>" +
    "<vUnCom>10</vUnCom><vProd>100</vProd><vDesc>10</vDesc></prod></det>" +
    "<total><ICMSTot><vNF>90</vNF></ICMSTot></total></infNFe></NFe></nfeProc>";
  const parsed = parseNfeXmlForUnifiedCatalog(xml)!;
  const prices = computeEffectiveUnitPricesForCatalogLines(parsed.lines, xml);
  assertEquals(prices[0]!.effectiveUnitPrice, 9);
});

Deno.test("preço efetivo: rateia frete global proporcional ao vProd", () => {
  const xml =
    `<nfeProc><NFe><infNFe>` +
    baseEmit +
    baseIde +
    "<det><prod><cProd>A</cProd><xProd>A</xProd><qCom>1</qCom><vUnCom>100</vUnCom><vProd>100</vProd></prod></det>" +
    "<det><prod><cProd>B</cProd><xProd>B</xProd><qCom>1</qCom><vUnCom>50</vUnCom><vProd>50</vProd></prod></det>" +
    "<total><ICMSTot><vNF>165</vNF><vFrete>15</vFrete></ICMSTot></total>" +
    "</infNFe></NFe></nfeProc>";
  const parsed = parseNfeXmlForUnifiedCatalog(xml)!;
  const prices = computeEffectiveUnitPricesForCatalogLines(parsed.lines, xml);
  assertEquals(prices[0]!.effectiveUnitPrice, 110);
  assertEquals(prices[1]!.effectiveUnitPrice, 55);
});
