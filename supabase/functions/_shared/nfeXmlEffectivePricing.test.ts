import { assertEquals } from "jsr:@std/assert@1";
import { parseNfeXmlToExtracted } from "./parseNfeXml.ts";

const baseEmit =
  "<emit><CNPJ>61186888000193</CNPJ><xNome>SPAL</xNome></emit>";
const baseIde =
  "<ide><nNF>1</nNF><serie>1</serie><dhEmi>2026-05-06T10:00:00-03:00</dhEmi></ide>";

Deno.test("parseNfeXmlToExtracted: aplica preço efetivo (linha simples = vUnCom)", () => {
  const xml =
    `<nfeProc><NFe><infNFe Id="NFe3526">` +
    baseEmit +
    baseIde +
    "<det><prod><cProd>1</cProd><xProd>Item</xProd><qCom>10</qCom><vUnCom>2</vUnCom><vProd>20</vProd><uCom>UN</uCom></prod></det>" +
    "<total><ICMSTot><vNF>20</vNF></ICMSTot></total>" +
    `</infNFe></NFe></nfeProc>`;
  const r = parseNfeXmlToExtracted(xml);
  assertEquals(r != null, true);
  assertEquals(r!.items[0]!.unitValue, 2);
  assertEquals(r!.items[0]!.lineTotal, 20);
  assertEquals(r!.items[0]!.unitValueCommercial, null);
  assertEquals(r!.totalAmount, 20);
});

Deno.test("parseNfeXmlToExtracted: vNF menos bonificação 5910 no total", () => {
  const xml =
    `<nfeProc><NFe><infNFe Id="NFe3526">` +
    baseEmit +
    baseIde +
    "<det><prod><cProd>1</cProd><xProd>Pago</xProd><CFOP>5102</CFOP><qCom>1</qCom><vUnCom>100</vUnCom><vProd>100</vProd></prod></det>" +
    "<det><prod><cProd>2</cProd><xProd>Bonif</xProd><CFOP>5910</CFOP><qCom>1</qCom><vUnCom>50</vUnCom><vProd>50</vProd></prod></det>" +
    "<total><ICMSTot><vNF>150</vNF></ICMSTot></total>" +
    `</infNFe></NFe></nfeProc>`;
  const r = parseNfeXmlToExtracted(xml);
  assertEquals(r != null, true);
  assertEquals(r!.items.length, 2);
  assertEquals(r!.totalAmount, 100);
});
