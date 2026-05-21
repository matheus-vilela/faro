import { assertEquals } from "jsr:@std/assert@1";
import { parseNfeXmlForUnifiedCatalog } from "./parseNfeXml.ts";
import { buildNfeUnitPricePreviewFromXml } from "./nfeUnitPricePreview.ts";
import {
  computeEffectiveUnitPricesForCatalogLines,
  extractNfeJurosFromXml,
  sumLineImpostoTaxFields,
} from "./nfeEffectiveUnitPrice.ts";

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

Deno.test("preço efetivo: IPI na linha aumenta unitário", () => {
  const xml =
    `<nfeProc><NFe><infNFe>` +
    baseEmit +
    baseIde +
    "<det><prod><cProd>A</cProd><xProd>Item</xProd><qCom>2</qCom>" +
    "<vUnCom>50</vUnCom><vProd>100</vProd></prod>" +
    "<imposto><IPI><IPITrib><vIPI>10</vIPI></IPITrib></IPI></imposto></det>" +
    "<total><ICMSTot><vNF>110</vNF><vIPI>10</vIPI></ICMSTot></total>" +
    "</infNFe></NFe></nfeProc>";
  const parsed = parseNfeXmlForUnifiedCatalog(xml)!;
  const prices = computeEffectiveUnitPricesForCatalogLines(parsed.lines, xml);
  assertEquals(prices[0]!.effectiveUnitPrice, 55);
});

Deno.test("preço efetivo: ICMS ST e FCP ST na linha", () => {
  const imposto =
    "<imposto><ICMS><ICMS10><vICMSST>20</vICMSST><vFCPST>5</vFCPST></ICMS10></ICMS></imposto>";
  const xml =
    `<nfeProc><NFe><infNFe>` +
    baseEmit +
    baseIde +
    "<det><prod><cProd>A</cProd><xProd>Item</xProd><qCom>1</qCom>" +
    "<vUnCom>100</vUnCom><vProd>100</vProd></prod>" +
    imposto +
    "</det>" +
    "<total><ICMSTot><vNF>125</vNF><vST>20</vST><vFCPST>5</vFCPST></ICMSTot></total>" +
    "</infNFe></NFe></nfeProc>";
  const parsed = parseNfeXmlForUnifiedCatalog(xml)!;
  const prices = computeEffectiveUnitPricesForCatalogLines(parsed.lines, xml);
  assertEquals(prices[0]!.effectiveUnitPrice, 125);
});

Deno.test("preço efetivo: rateia IPI global quando a linha não traz imposto", () => {
  const xml =
    `<nfeProc><NFe><infNFe>` +
    baseEmit +
    baseIde +
    "<det><prod><cProd>A</cProd><xProd>A</xProd><qCom>1</qCom><vUnCom>100</vUnCom><vProd>100</vProd></prod></det>" +
    "<det><prod><cProd>B</cProd><xProd>B</xProd><qCom>1</qCom><vUnCom>50</vUnCom><vProd>50</vProd></prod></det>" +
    "<total><ICMSTot><vNF>165</vNF><vIPI>15</vIPI></ICMSTot></total>" +
    "</infNFe></NFe></nfeProc>";
  const parsed = parseNfeXmlForUnifiedCatalog(xml)!;
  const prices = computeEffectiveUnitPricesForCatalogLines(parsed.lines, xml);
  assertEquals(prices[0]!.effectiveUnitPrice, 110);
  assertEquals(prices[1]!.effectiveUnitPrice, 55);
});

Deno.test("juros: parcelas acima do vNF", () => {
  const xml =
    `<nfeProc><NFe><infNFe>` +
    baseEmit +
    baseIde +
    "<det><prod><cProd>A</cProd><xProd>Item</xProd><qCom>1</qCom>" +
    "<vUnCom>100</vUnCom><vProd>100</vProd></prod></det>" +
    "<total><ICMSTot><vNF>100</vNF></ICMSTot></total>" +
    "<cobr><dup><nDup>001</nDup><dVenc>2026-06-01</dVenc><vDup>105</vDup></dup></cobr>" +
    "</infNFe></NFe></nfeProc>";
  assertEquals(extractNfeJurosFromXml(xml), 5);
  const parsed = parseNfeXmlForUnifiedCatalog(xml)!;
  const prices = computeEffectiveUnitPricesForCatalogLines(parsed.lines, xml);
  assertEquals(prices[0]!.effectiveUnitPrice, 105);
});

Deno.test("preço efetivo: uCom PAC + uTrib UN usa qTrib e vUnTrib", () => {
  const xml =
    `<nfeProc><NFe><infNFe>` +
    baseEmit +
    baseIde +
    "<det><prod><cProd>A</cProd><xProd>Item</xProd>" +
    "<qCom>1</qCom><uCom>PAC</uCom><vUnCom>120</vUnCom>" +
    "<qTrib>12</qTrib><uTrib>UN</uTrib><vUnTrib>10</vUnTrib>" +
    "<vProd>120</vProd></prod></det>" +
    "<total><ICMSTot><vNF>120</vNF></ICMSTot></total></infNFe></NFe></nfeProc>";
  const parsed = parseNfeXmlForUnifiedCatalog(xml)!;
  const prices = computeEffectiveUnitPricesForCatalogLines(parsed.lines, xml);
  assertEquals(prices[0]!.effectiveUnitPrice, 10);
});

Deno.test("sumLineImpostoTaxFields agrega blocos aninhados", () => {
  const imposto = {
    IPI: { IPITrib: { vIPI: 3 } },
    ICMS: { ICMS10: { vICMSST: 7, vFCPST: 2 } },
  };
  assertEquals(sumLineImpostoTaxFields(imposto), {
    vIPI: 3,
    vICMSST: 7,
    vFCPST: 2,
  });
});

Deno.test("sumLineImpostoTaxFields: vST no ICMS quando não há vICMSST", () => {
  const imposto = {
    ICMS: { ICMS60: { vST: 12, vFCPST: 1 } },
  };
  assertEquals(sumLineImpostoTaxFields(imposto).vICMSST, 12);
});

Deno.test("ICMS ST na tabela = só linha (sem misturar rateio ST em Outros)", () => {
  const xml =
    `<nfeProc><NFe><infNFe>` +
    "<emit><CNPJ>61186888000193</CNPJ><xNome>F</xNome></emit>" +
    "<ide><nNF>1</nNF><serie>1</serie></ide>" +
    "<det><prod><cProd>A</cProd><xProd>A</xProd><qCom>1</qCom>" +
    "<vUnCom>100</vUnCom><vProd>100</vProd></prod>" +
    "<imposto><ICMS><ICMS10><vICMSST>20</vICMSST></ICMS10></ICMS></imposto></det>" +
    "<det><prod><cProd>B</cProd><xProd>B</xProd><qCom>1</qCom>" +
    "<vUnCom>50</vUnCom><vProd>50</vProd></prod></det>" +
    "<total><ICMSTot><vNF>170</vNF><vST>30</vST></ICMSTot></total>" +
    "</infNFe></NFe></nfeProc>";
  const preview = buildNfeUnitPricePreviewFromXml(xml)!;
  assertEquals(preview.lines[0]!.row!.icms_st_line, 20);
  assertEquals(preview.lines[1]!.row!.icms_st_line, 0);
  assertEquals(preview.lines[0]!.row!.outros, 0);
  assertEquals(preview.lines[1]!.row!.outros, 0);
});

Deno.test("coluna Outros: rateia vOutro do ICMSTot por vProd; soma = outras despesas", () => {
  const xml =
    `<nfeProc><NFe><infNFe>` +
    "<emit><CNPJ>61186888000193</CNPJ><xNome>F</xNome></emit>" +
    "<ide><nNF>1</nNF><serie>1</serie></ide>" +
    "<det><prod><cProd>A</cProd><xProd>A</xProd><qCom>1</qCom>" +
    "<vUnCom>100</vUnCom><vProd>100</vProd></prod></det>" +
    "<det><prod><cProd>B</cProd><xProd>B</xProd><qCom>1</qCom>" +
    "<vUnCom>50</vUnCom><vProd>50</vProd></prod></det>" +
    "<det><prod><cProd>G</cProd><xProd>Bonif</xProd><CFOP>5910</CFOP>" +
    "<qCom>1</qCom><vUnCom>200</vUnCom><vProd>200</vProd></prod></det>" +
    "<total><ICMSTot><vNF>350</vNF><vOutro>15</vOutro></ICMSTot></total>" +
    "</infNFe></NFe></nfeProc>";
  const preview = buildNfeUnitPricePreviewFromXml(xml)!;
  assertEquals(preview.nota.v_outro_icms_tot, 15);
  assertEquals(preview.nota.soma_coluna_outros, 15);
  assertEquals(preview.lines[2]!.is_bonification, true);
  assertEquals(preview.lines[2]!.row!.outros, 0);
  assertEquals(preview.lines[0]!.row!.outros, 10);
  assertEquals(preview.lines[1]!.row!.outros, 5);
});
