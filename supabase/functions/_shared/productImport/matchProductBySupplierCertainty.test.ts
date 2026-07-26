import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { matchProductBySupplierCertainty } from "./matchProductBySupplierCertainty.ts";

const companyId = "co-1";
const supplierId = "sup-1";

function fakeSupabase(opts: {
  cProdProductId?: string | null;
}) {
  return {
    from(table: string) {
      if (table === "product_supplier_codes") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle: async () => ({
            data: opts.cProdProductId
              ? { product_id: opts.cProdProductId }
              : null,
            error: null,
          }),
          limit: async () => ({ data: [], error: null }),
        };
      }
      if (table === "expenses") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          order() {
            return this;
          },
          limit: async () => ({ data: [], error: null }),
        };
      }
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle: async () => ({ data: null, error: null }),
        limit: async () => ({ data: [], error: null }),
      };
    },
  };
}

Deno.test("supplier certainty: cProd do fornecedor vincula", async () => {
  const hit = await matchProductBySupplierCertainty({
    supabase: fakeSupabase({ cProdProductId: "p-cprod" }),
    companyId,
    supplierId,
    line: { nome: "X", codigo: "ABC123", ean: null },
    catalog: [
      { id: "p-cprod", name: "Produto A", sku: null, ean: null },
      { id: "p-other", name: "Outro", ean: "7891234567890" },
    ],
    supplierHints: {
      preferredProductIds: new Set(["p-cprod"]),
      nameKeyToProductId: new Map(),
    },
  });
  assertEquals(hit?.productId, "p-cprod");
  assertEquals(hit?.criterio, "cprod_fornecedor");
});

Deno.test("supplier certainty: EAN órfão (empresa, sem fornecedor) NÃO vincula", async () => {
  const hit = await matchProductBySupplierCertainty({
    supabase: fakeSupabase({ cProdProductId: null }),
    companyId,
    supplierId,
    line: { nome: "X", codigo: null, ean: "7891234567890" },
    catalog: [
      { id: "p-ean", name: "Mesmo EAN outro fornecedor", ean: "7891234567890" },
    ],
    supplierHints: {
      preferredProductIds: new Set(), // sem vínculo com este fornecedor
      nameKeyToProductId: new Map(),
    },
  });
  assertEquals(hit, null);
});

Deno.test("supplier certainty: EAN só vincula se produto já for do fornecedor", async () => {
  const hit = await matchProductBySupplierCertainty({
    supabase: fakeSupabase({ cProdProductId: null }),
    companyId,
    supplierId,
    line: { nome: "X", codigo: null, ean: "7891234567890" },
    catalog: [
      { id: "p-ean", name: "Item", ean: "7891234567890" },
    ],
    supplierHints: {
      preferredProductIds: new Set(["p-ean"]),
      nameKeyToProductId: new Map(),
    },
  });
  assertEquals(hit?.productId, "p-ean");
  assertEquals(hit?.criterio, "ean_fornecedor");
});

Deno.test("supplier certainty: SKU global sem fornecedor NÃO vincula", async () => {
  const hit = await matchProductBySupplierCertainty({
    supabase: fakeSupabase({ cProdProductId: null }),
    companyId,
    supplierId,
    line: { nome: "X", codigo: "SKU1", ean: null },
    catalog: [
      { id: "p-sku", name: "Item", sku: "SKU1" },
    ],
    supplierHints: {
      preferredProductIds: new Set(),
      nameKeyToProductId: new Map(),
    },
  });
  assertEquals(hit, null);
});

Deno.test("supplier certainty: SKU vincula só no escopo do fornecedor", async () => {
  const hit = await matchProductBySupplierCertainty({
    supabase: fakeSupabase({ cProdProductId: null }),
    companyId,
    supplierId,
    line: { nome: "X", codigo: "SKU1", ean: null },
    catalog: [
      { id: "p-sku", name: "Item", sku: "SKU1" },
    ],
    supplierHints: {
      preferredProductIds: new Set(["p-sku"]),
      nameKeyToProductId: new Map(),
    },
  });
  assertEquals(hit?.productId, "p-sku");
  assertEquals(hit?.criterio, "sku_igual_cprod_fornecedor");
});

Deno.test("supplier certainty: sem supplierId → null (cria)", async () => {
  const hit = await matchProductBySupplierCertainty({
    supabase: fakeSupabase({}),
    companyId,
    supplierId: null,
    line: { nome: "X", codigo: "A", ean: "789" },
    catalog: [{ id: "p1", name: "X", ean: "789", sku: "A" }],
    supplierHints: {
      preferredProductIds: new Set(["p1"]),
      nameKeyToProductId: new Map(),
    },
  });
  assertEquals(hit, null);
});

Deno.test("supplier certainty: nome igual NÃO vincula", async () => {
  const hit = await matchProductBySupplierCertainty({
    supabase: fakeSupabase({ cProdProductId: null }),
    companyId,
    supplierId,
    line: { nome: "AGUA COM GAS", codigo: null, ean: null },
    catalog: [
      {
        id: "p1",
        name: "AGUA COM GAS",
        canonical_name: "agua gas",
      },
    ],
    supplierHints: {
      preferredProductIds: new Set(["p1"]),
      nameKeyToProductId: new Map([["agua gas", "p1"]]),
    },
  });
  assertEquals(hit, null);
});
