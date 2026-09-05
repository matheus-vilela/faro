import { afterEach, describe, expect, it } from "vitest";
import type { ProductSetupItem, ProductSetupQueue } from "@/lib/productSetupQueue";
import type { ProductValidationResult } from "@/lib/productValidation/types";
import {
  beginProductValidationRun,
  defaultPicksFromResult,
  finishProductValidationRun,
  getProductValidationSession,
  patchProductValidationSession,
  resetProductValidationSessionsForTests,
  samePickIds,
  startProductValidationSession,
  subscribeProductValidationSession,
} from "@/lib/productValidation/session";

function sold(id: string, name: string): ProductSetupItem {
  return {
    key: `sold:${id}`,
    productId: id,
    name,
    unit: "un",
    quantity: 4,
    kind: "sold_unlinked",
    sourceLabel: "PDV",
    pendingQuestion: "",
  };
}

function purchase(id: string, name: string): ProductSetupItem {
  return {
    key: `purchase:${id}`,
    productId: id,
    name,
    unit: "un",
    quantity: 10,
    kind: "purchase_unlinked",
    sourceLabel: "Nota",
    pendingQuestion: "",
  };
}

function resultWithHighMatch(): ProductValidationResult {
  const soldItem = sold("s1", "Heineken");
  const purchaseItem = purchase("p1", "Heineken 600");
  return {
    sameItem: [
      {
        id: "same:s1",
        sold: soldItem,
        candidates: [{ purchase: purchaseItem, score: 96, reasons: [] }],
        band: "high",
        conflictWithRecipe: false,
      },
    ],
    recipes: [],
    residual: [],
    unmatchedSold: [],
    stats: { sold: 1, purchases: 1, sameItem: 1, recipes: 0, residual: 0 },
  };
}

function emptyQueue(): ProductSetupQueue {
  return {
    items: [],
    counts: { total: 0, purchases: 0, sold: 0, recipes: 0 },
    soldOnly: [],
    purchases: [],
    recipes: [],
    error: null,
  };
}

afterEach(() => {
  resetProductValidationSessionsForTests();
});

describe("defaultPicksFromResult", () => {
  it("pré-seleciona pares high", () => {
    const picks = defaultPicksFromResult(resultWithHighMatch());
    expect(picks.samePick["same:s1"]).toEqual(["p1"]);
    expect(picks.soldPick["same:s1"]).toBe("s1");
  });

  it("pré-seleciona todas as notas do mesmo vendido", () => {
    const base = resultWithHighMatch();
    const extra = purchase("p2", "Heineken outro fornecedor");
    const picks = defaultPicksFromResult({
      ...base,
      sameItem: [
        {
          ...base.sameItem[0]!,
          candidates: [
            ...base.sameItem[0]!.candidates,
            { purchase: extra, score: 92, reasons: [] },
          ],
        },
      ],
    });
    expect(picks.samePick["same:s1"]).toEqual(["p1", "p2"]);
  });
});

describe("samePickIds", () => {
  it("aceita lista ou valor único legado", () => {
    expect(samePickIds({ a: ["p1", "p2"] }, "a")).toEqual(["p1", "p2"]);
    expect(samePickIds({ a: "p1" }, "a")).toEqual(["p1"]);
    expect(samePickIds({}, "a")).toEqual([]);
  });
});

describe("product validation session", () => {
  it("mantém resultado depois de um subscribe sair", () => {
    const companyId = "c1";
    const seen: boolean[] = [];
    const stop = subscribeProductValidationSession(companyId, (state) => {
      seen.push(state.running);
    });
    beginProductValidationRun(companyId);
    expect(getProductValidationSession(companyId).running).toBe(true);
    stop();
    finishProductValidationRun(companyId, 1, {
      ok: true,
      result: resultWithHighMatch(),
    });
    const stored = getProductValidationSession(companyId);
    expect(stored.running).toBe(false);
    expect(stored.result?.stats.sameItem).toBe(1);
    expect(stored.samePick["same:s1"]).toEqual(["p1"]);
  });

  it("ignora resposta antiga quando uma nova geração começou", () => {
    const companyId = "c1";
    beginProductValidationRun(companyId);
    beginProductValidationRun(companyId);
    const appliedOld = finishProductValidationRun(companyId, 1, {
      ok: true,
      result: resultWithHighMatch(),
    });
    expect(appliedOld).toBe(false);
    expect(getProductValidationSession(companyId).running).toBe(true);
    expect(getProductValidationSession(companyId).result).toBeNull();
  });

  it("não inicia de novo enquanto já está processando", async () => {
    const companyId = "c1";
    let correlateCalls = 0;
    let release!: (value: { ok: true; result: ProductValidationResult; runId: null }) => void;
    const first = startProductValidationSession({
      companyId,
      loadQueue: async () => emptyQueue(),
      correlate: () =>
        new Promise((resolve) => {
          correlateCalls += 1;
          release = resolve;
        }),
    });
    const second = await startProductValidationSession({
      companyId,
      loadQueue: async () => emptyQueue(),
      correlate: async () => {
        correlateCalls += 1;
        return { ok: true, runId: null, result: resultWithHighMatch() };
      },
    });
    expect(second).toEqual({ ok: true });
    expect(correlateCalls).toBe(1);
    release({ ok: true, runId: null, result: resultWithHighMatch() });
    await first;
    expect(getProductValidationSession(companyId).result?.stats.sameItem).toBe(1);
  });

  it("isola sessões por empresa", () => {
    beginProductValidationRun("a");
    finishProductValidationRun("b", beginProductValidationRun("b"), {
      ok: true,
      result: resultWithHighMatch(),
    });
    expect(getProductValidationSession("a").running).toBe(true);
    expect(getProductValidationSession("a").result).toBeNull();
    expect(getProductValidationSession("b").running).toBe(false);
    expect(getProductValidationSession("b").result?.stats.sameItem).toBe(1);
  });

  it("guarda seleção editada pelo usuário", () => {
    const companyId = "c1";
    finishProductValidationRun(companyId, beginProductValidationRun(companyId), {
      ok: true,
      result: resultWithHighMatch(),
    });
    patchProductValidationSession(companyId, (prev) => ({
      samePick: { ...prev.samePick, "same:s1": ["p-other"] },
    }));
    expect(getProductValidationSession(companyId).samePick["same:s1"]).toEqual([
      "p-other",
    ]);
  });
});
