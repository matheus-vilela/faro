import { assertEquals } from "jsr:@std/assert@1";
import { parseNfeXmlToExtracted } from "./parseNfeXml.ts";

const baseEmit =
  "<emit><CNPJ>61186888000193</CNPJ><xNome>SPAL</xNome></emit>";
const baseIde =
  "<ide><nNF>16609783</nNF><serie>16</serie><dhEmi>2026-05-06T10:00:00-03:00</dhEmi></ide>";
const baseTotal = "<total><ICMSTot><vNF>1939.59</vNF></ICMSTot></total>";

Deno.test("parseNfeXmlToExtracted: nfeProc padrão com um det", () => {
  const xml =
    `<nfeProc><NFe><infNFe Id="NFe35260561186888000193550160166097831008206180">` +
    baseEmit +
    baseIde +
    "<det><prod><cProd>1</cProd><xProd>Refrigerante</xProd><qCom>12</qCom><vUnCom>5.50</vUnCom><vProd>66.00</vProd><uCom>UN</uCom></prod></det>" +
    baseTotal +
    `</infNFe></NFe></nfeProc>`;
  const r = parseNfeXmlToExtracted(xml);
  assertEquals(r != null, true);
  assertEquals(r!.items.length, 1);
  assertEquals(r!.items[0]!.productName, "Refrigerante");
  assertEquals(r!.totalAmount, 1939.59);
});

Deno.test("parseNfeXmlToExtracted: dois infNFe — usa o que tem det", () => {
  const xml =
    `<nfeProc><NFe>` +
    `<infNFe Id="NFeX1">${baseEmit}${baseIde}${baseTotal}</infNFe>` +
    `<infNFe Id="NFe35260561186888000193550160166097831008206180">` +
    baseEmit +
    baseIde +
    "<det><prod><cProd>9</cProd><xProd>Item B</xProd><qCom>1</qCom><vUnCom>10</vUnCom><vProd>10</vProd></prod></det>" +
    baseTotal +
    `</infNFe>` +
    `</NFe></nfeProc>`;
  const r = parseNfeXmlToExtracted(xml);
  assertEquals(r != null, true);
  assertEquals(r!.items.length, 1);
  assertEquals(r!.items[0]!.productName, "Item B");
});

Deno.test("parseNfeXmlToExtracted: prod duplicado no det — usa primeiro prod", () => {
  const xml =
    `<nfeProc><NFe><infNFe Id="NFe3526">` +
    baseEmit +
    baseIde +
    "<det><prod><cProd>1</cProd><xProd>Primeiro</xProd><qCom>1</qCom><vUnCom>5</vUnCom><vProd>5</vProd></prod>" +
    "<prod><cProd>2</cProd><xProd>Segundo</xProd><qCom>1</qCom><vUnCom>7</vUnCom><vProd>7</vProd></prod></det>" +
    "<total><ICMSTot><vNF>12</vNF></ICMSTot></total>" +
    `</infNFe></NFe></nfeProc>`;
  const r = parseNfeXmlToExtracted(xml);
  assertEquals(r != null, true);
  assertEquals(r!.items.length, 1);
  assertEquals(r!.items[0]!.productName, "Primeiro");
});

Deno.test("parseNfeXmlToExtracted: sem det mas com vNF — linha sintética", () => {
  const xml =
    `<nfeProc><NFe><infNFe Id="NFe35260561186888000193550160166097831008206180">` +
    baseEmit +
    baseIde +
    baseTotal +
    `</infNFe></NFe></nfeProc>`;
  const r = parseNfeXmlToExtracted(xml);
  assertEquals(r != null, true);
  assertEquals(r!.items.length, 1);
  assertEquals(r!.items[0]!.lineTotal, 1939.59);
  assertEquals(
    String(r!.items[0]!.productName).includes("não extraídos"),
    true,
  );
});

Deno.test("parseNfeXmlToExtracted: ignora BOM no início", () => {
  const inner =
    `<nfeProc><NFe><infNFe Id="NFe3526">` +
    baseEmit +
    baseIde +
    "<det><prod><xProd>X</xProd><qCom>1</qCom><vUnCom>3</vUnCom><vProd>3</vProd></prod></det>" +
    "<total><ICMSTot><vNF>3</vNF></ICMSTot></total></infNFe></NFe></nfeProc>";
  const r = parseNfeXmlToExtracted("\uFEFF" + inner);
  assertEquals(r != null, true);
  assertEquals(r!.items[0]!.productName, "X");
});
