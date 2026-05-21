import { assertEquals } from "jsr:@std/assert@1";
import { priceBoundNfeXmlUpdates } from "./nfePriceBoundXml.ts";

Deno.test("priceBoundNfeXmlUpdates: grava XML ao renovar min e max", () => {
  const xmlMin = "<nfeProc><NFe>min</NFe></nfeProc>";
  const xmlMax = "<nfeProc><NFe>max</NFe></nfeProc>";
  const chave = "35260561186888000193550160166097831008206180";

  const first = priceBoundNfeXmlUpdates({
    observed: 10,
    prevMin: null,
    prevMax: null,
    bounds: { min_price: 10, max_price: 10 },
    chaveNfe: chave,
    xmlText: xmlMin,
  });
  assertEquals(first.min_price_nfe_xml, xmlMin);
  assertEquals(first.max_price_nfe_xml, xmlMin);

  const lower = priceBoundNfeXmlUpdates({
    observed: 8,
    prevMin: 10,
    prevMax: 10,
    bounds: { min_price: 8, max_price: 10 },
    chaveNfe: chave,
    xmlText: xmlMin,
  });
  assertEquals(lower.min_price_nfe_xml, xmlMin);
  assertEquals(lower.max_price_nfe_xml, undefined);

  const higher = priceBoundNfeXmlUpdates({
    observed: 12,
    prevMin: 8,
    prevMax: 10,
    bounds: { min_price: 8, max_price: 12 },
    chaveNfe: chave,
    xmlText: xmlMax,
  });
  assertEquals(higher.min_price_nfe_xml, undefined);
  assertEquals(higher.max_price_nfe_xml, xmlMax);
});
