import { describe, expect, it } from "vitest";
import {
  aggregateCompanyNcms,
  filterCompanyNcms,
  similarUnmappedNcms,
  unmappedCount,
} from "@/lib/ncm/companyNcms";

describe("aggregateCompanyNcms", () => {
  it("une produtos, linhas de NF e regras, com exemplos e unmapped primeiro", () => {
    const rows = aggregateCompanyNcms({
      products: [
        { name: "Fanta Laranja", ncm: "2202.10.00" },
        { name: "Coca-Cola 350ml", ncm: "22021000" },
        { name: "Sem código", ncm: null },
        { name: "Lixo", ncm: "00000000" },
      ],
      expenseItems: [
        { product_name: "Coca 2L", ncm: "22021000" },
        { product_name: "Heineken", ncm: "22030000" },
      ],
      rules: [{ ncm: "22030000", product_category_id: "cervejas" }],
    });

    expect(rows.map((r) => r.ncm)).toEqual(["22021000", "22030000"]);
    expect(rows[0]).toMatchObject({
      ncm: "22021000",
      productCount: 2,
      expenseItemCount: 1,
      categoryId: null,
    });
    expect(rows[0]!.sampleProductNames).toEqual([
      "Coca 2L",
      "Coca-Cola 350ml",
      "Fanta Laranja",
    ]);
    expect(rows[1]).toMatchObject({
      ncm: "22030000",
      productCount: 0,
      expenseItemCount: 1,
      categoryId: "cervejas",
      dreCategoryId: null,
    });
  });

  it("inclui NCM só da regra (cadastro manual)", () => {
    const rows = aggregateCompanyNcms({
      products: [],
      expenseItems: [],
      rules: [{ ncm: "19059090", product_category_id: "paes" }],
    });
    expect(rows).toEqual([
      {
        ncm: "19059090",
        productCount: 0,
        expenseItemCount: 0,
        sampleProductNames: [],
        categoryId: "paes",
        dreCategoryId: null,
      },
    ]);
  });
});

describe("filterCompanyNcms", () => {
  const rows = aggregateCompanyNcms({
    products: [
      { name: "Coca-Cola", ncm: "22021000" },
      { name: "Pão francês", ncm: "19059090" },
    ],
    expenseItems: [],
    rules: [{ ncm: "19059090", product_category_id: "paes" }],
  });

  it("filtra sem categoria por padrão de inbox", () => {
    expect(filterCompanyNcms(rows, "unmapped", "").map((r) => r.ncm)).toEqual([
      "22021000",
    ]);
    expect(filterCompanyNcms(rows, "mapped", "").map((r) => r.ncm)).toEqual([
      "19059090",
    ]);
    expect(unmappedCount(rows)).toBe(1);
  });

  it("busca por dígitos do NCM ou nome de produto", () => {
    expect(filterCompanyNcms(rows, "all", "2202").map((r) => r.ncm)).toEqual([
      "22021000",
    ]);
    expect(filterCompanyNcms(rows, "all", "pão").map((r) => r.ncm)).toEqual([
      "19059090",
    ]);
  });
});

describe("similarUnmappedNcms", () => {
  it("lista outros NCMs do mesmo capítulo ainda sem categoria", () => {
    const rows = aggregateCompanyNcms({
      products: [
        { name: "Coca", ncm: "22021000" },
        { name: "Água", ncm: "22011000" },
        { name: "Guaraná", ncm: "22021000" },
      ],
      expenseItems: [{ product_name: "Tônica", ncm: "22021010" }],
      rules: [{ ncm: "22011000", product_category_id: "aguas" }],
    });
    expect(similarUnmappedNcms(rows, "22021000").map((r) => r.ncm)).toEqual([
      "22021010",
    ]);
  });
});
