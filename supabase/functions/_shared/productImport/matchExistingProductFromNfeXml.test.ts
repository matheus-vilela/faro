import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { matchExistingProductFromNfeXmlLine } from "./matchExistingProductFromNfeXml.ts";

Deno.test("match: EAN tem prioridade", async () => {
  const hit = await matchExistingProductFromNfeXmlLine({
    line: {
      nome: "OUTRO NOME",
      ean: "7891234567890",
      codigo: "ABC",
      ncm: "22011000",
    },
    catalog: [
      { id: "p1", name: "AGUA", ean: "7891234567890" },
      { id: "p2", name: "OUTRO NOME", ncm: "22011000" },
    ],
  });
  assertEquals(hit?.productId, "p1");
  assertEquals(hit?.criterio, "ean");
});

Deno.test("match: nome do XML reutiliza cadastro existente", async () => {
  const hit = await matchExistingProductFromNfeXmlLine({
    line: {
      nome: "ÁGUA COM GÁS 12X500ML",
      ean: null,
      codigo: null,
      ncm: "22011000",
    },
    catalog: [
      {
        id: "p1",
        name: "AGUA COM GAS",
        canonical_name: "agua gas",
        ncm: "22011000",
      },
    ],
  });
  assertEquals(hit?.productId, "p1");
  assertEquals(
    hit?.criterio === "ncm_e_nome" ||
      hit?.criterio === "canonical_name" ||
      hit?.criterio === "nome_catalogo",
    true,
  );
});

Deno.test("match: histórico do fornecedor vincula pelo nome da compra", async () => {
  const hit = await matchExistingProductFromNfeXmlLine({
    line: {
      nome: "REFRIGERANTE COLA 2L",
      ean: null,
      codigo: "X1",
    },
    catalog: [
      { id: "p9", name: "REFRIGERANTE COLA 2L" },
      { id: "p1", name: "OUTRO" },
    ],
    supplierHints: {
      preferredProductIds: new Set(["p9"]),
      nameKeyToProductId: new Map([
        ["refrigerante cola 2l", "p9"],
      ]),
    },
  });
  assertEquals(hit?.productId, "p9");
  assertEquals(hit?.criterio, "historico_fornecedor");
});

Deno.test("match: sem identificadores e sem nome → null (cria)", async () => {
  const hit = await matchExistingProductFromNfeXmlLine({
    line: { nome: "PRODUTO ZZZ INEXISTENTE XYZ", ean: null, codigo: null },
    catalog: [{ id: "p1", name: "AGUA" }],
  });
  assertEquals(hit, null);
});
