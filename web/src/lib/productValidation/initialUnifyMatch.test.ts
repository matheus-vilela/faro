import { describe, expect, it } from "vitest";
import type { ProductSetupItem } from "@/lib/productSetupQueue";
import {
  isInitialUnifyMatch,
  type SameItemSuggestion,
} from "@/lib/productValidation/types";

function sold(name: string): ProductSetupItem {
  return {
    key: `sold:${name}`,
    productId: name,
    name,
    unit: "un",
    quantity: 0,
    kind: "sold_unlinked",
    sourceLabel: "PDV",
    pendingQuestion: "",
  };
}

function suggestion(
  extra: Partial<SameItemSuggestion> = {},
): SameItemSuggestion {
  return {
    id: "same:x",
    sold: sold("Gin"),
    candidates: [],
    band: "high",
    conflictWithRecipe: false,
    ...extra,
  };
}

describe("isInitialUnifyMatch", () => {
  it("aceita mesmo produto com confiança alta", () => {
    expect(isInitialUnifyMatch(suggestion())).toBe(true);
  });

  it("ignora possível ficha no bloco inicial", () => {
    expect(
      isInitialUnifyMatch(suggestion({ conflictWithRecipe: true })),
    ).toBe(false);
  });

  it("ignora match abaixo de 90%", () => {
    expect(isInitialUnifyMatch(suggestion({ band: "review" }))).toBe(false);
  });
});
