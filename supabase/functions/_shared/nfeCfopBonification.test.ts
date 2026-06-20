import { assertEquals } from "jsr:@std/assert@1";
import { buildNfeUnitPricePreviewFromXml } from "./nfeUnitPricePreview.ts";
import { isNfeBonificationCfop } from "./nfeCfopBonification.ts";
import { parseNfeXmlForUnifiedCatalog } from "./parseNfeXml.ts";
import { computeEffectiveUnitPricesForCatalogLines } from "./nfeEffectiveUnitPrice.ts";

Deno.test("isNfeBonificationCfop: 5910", () => {
  assertEquals(isNfeBonificationCfop("5910"), true);
  assertEquals(isNfeBonificationCfop("5.910"), true);
  assertEquals(isNfeBonificationCfop("5102"), false);
});

Deno.test("CFOP 5910: sem rateio de juros; valor real = vNF − bonificação", () => {
  const xml =
    `<nfeProc><NFe><infNFe>` +
    "<emit><CNPJ>61186888000193</CNPJ><xNome>F</xNome></emit>" +
    "<ide><nNF>1</nNF><serie>1</serie></ide>" +
    "<det nItem=\"1\"><prod><cProd>P</cProd><xProd>Pago</xProd>" +
    "<CFOP>5102</CFOP><qCom>1</qCom><vUnCom>100</vUnCom><vProd>100</vProd></prod></det>" +
    "<det nItem=\"2\"><prod><cProd>B</cProd><xProd>Bonif</xProd>" +
    "<CFOP>5910</CFOP><qCom>1</qCom><vUnCom>50</vUnCom><vProd>50</vProd></prod></det>" +
    "<total><ICMSTot><vNF>150</vNF></ICMSTot></total>" +
    "<cobr><dup><nDup>1</nDup><dVenc>2026-06-01</dVenc><vDup>160</vDup></dup></cobr>" +
    "</infNFe></NFe></nfeProc>";

  const parsed = parseNfeXmlForUnifiedCatalog(xml)!;
  const prices = computeEffectiveUnitPricesForCatalogLines(parsed.lines, xml);
  assertEquals(prices[0]!.is_bonification, false);
  assertEquals(prices[1]!.is_bonification, true);
  assertEquals(prices[1]!.breakdown?.global_juros_allocation, 0);

  const preview = buildNfeUnitPricePreviewFromXml(xml)!;
  assertEquals(preview.lines[1]!.is_bonification, true);
  assertEquals(preview.nota.v_nf, 150);
  assertEquals(preview.nota.soma_bonificacao_5910, 50);
  assertEquals(preview.nota.valor_real_nota, 100);
});
