import { describe, expect, it } from "vitest";
import {
  buildNextConversionsAfterHubChange,
  computeStockQuantityAfterHubChange,
} from "@/lib/companyUnits/stockHubUnitChange";
import { rebaseProductConversionsToHub } from "@/lib/companyUnits/convert";

describe("rebaseProductConversionsToHub cx → l", () => {
  const cxConvs = [
    {
      primary_unit_code: "cx",
      primary_qty: 1,
      secondary_unit_code: "un",
      secondary_qty: 12,
    },
    {
      primary_unit_code: "cx",
      primary_qty: 1,
      secondary_unit_code: "ml",
      secondary_qty: 6000,
    },
    {
      primary_unit_code: "cx",
      primary_qty: 1,
      secondary_unit_code: "l",
      secondary_qty: 6,
    },
  ];

  it("rebaseia estoque e conversões para litro como hub", () => {
    const rebased = buildNextConversionsAfterHubChange(cxConvs, "cx", "l");

    const bySec = Object.fromEntries(
      rebased.map((r) => [r.secondary_unit_code, r]),
    );

    expect(bySec.un).toMatchObject({
      primary_qty: 1,
      secondary_qty: 2,
    });
    expect(bySec.cx).toMatchObject({
      primary_qty: 1,
      secondary_qty: 1 / 6,
    });
    expect(bySec.ml).toBeUndefined();

    const stock = computeStockQuantityAfterHubChange(
      142,
      "cx",
      "l",
      cxConvs,
      rebased,
    );
    expect(stock).toBe(852);
  });

  it("rebase direto mantém razões equivalentes", () => {
    const rebased = rebaseProductConversionsToHub(cxConvs, "cx", "l");
    const un = rebased.find((r) => r.secondary_unit_code === "un");
    expect(un?.primary_qty).toBe(1);
    expect(un?.secondary_qty).toBe(2);
  });
});

describe("buildNextConversionsAfterHubChange cx → un", () => {
  const cxConvs = [
    {
      primary_unit_code: "cx",
      primary_qty: 1,
      secondary_unit_code: "un",
      secondary_qty: 12,
    },
    {
      primary_unit_code: "cx",
      primary_qty: 1,
      secondary_unit_code: "ml",
      secondary_qty: 6000,
    },
    {
      primary_unit_code: "cx",
      primary_qty: 1,
      secondary_unit_code: "l",
      secondary_qty: 6,
    },
  ];

  it("preserva ml/l rebaseadas e não injeta 1 un = 100 g", () => {
    const rebased = buildNextConversionsAfterHubChange(cxConvs, "cx", "un");
    const bySec = Object.fromEntries(
      rebased.map((r) => [r.secondary_unit_code, r]),
    );

    expect(bySec.g).toBeUndefined();
    expect(bySec.ml).toMatchObject({
      primary_qty: 1,
      secondary_qty: 500,
    });
    expect(bySec.l).toMatchObject({
      primary_qty: 1,
      secondary_qty: 0.5,
    });
    expect(bySec.cx).toMatchObject({
      primary_qty: 1,
      secondary_qty: 1 / 12,
    });

    const stock = computeStockQuantityAfterHubChange(
      142,
      "cx",
      "un",
      cxConvs,
      rebased,
    );
    expect(stock).toBe(142 * 12);
  });
});
