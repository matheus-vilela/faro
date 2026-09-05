import { describe, expect, it } from "vitest";
import { mergeSurvivorLock } from "@/lib/mergeSurvivorLock";

describe("mergeSurvivorLock", () => {
  it("libera a troca quando ninguém tem unificações", () => {
    expect(mergeSurvivorLock({ merged_catalog_names: [] }, { merged_catalog_names: [] }))
      .toEqual({ locked: false });
  });

  it("mantém o parceiro quando só ele já unificou itens", () => {
    const lock = mergeSurvivorLock(
      { merged_catalog_names: [] },
      { merged_catalog_names: ["Coca 350", "Coca Lata"] },
    );
    expect(lock.locked).toBe(true);
    if (lock.locked) expect(lock.survivor).toBe("partner");
  });

  it("mantém a origem quando só ela já unificou itens", () => {
    const lock = mergeSurvivorLock(
      { merged_catalog_names: ["Heineken"] },
      { merged_catalog_names: [] },
    );
    expect(lock.locked).toBe(true);
    if (lock.locked) expect(lock.survivor).toBe("source");
  });

  it("no empate de hubs, permanece o parceiro", () => {
    const lock = mergeSurvivorLock(
      { merged_catalog_names: ["A"] },
      { merged_catalog_names: ["B"] },
    );
    expect(lock.locked).toBe(true);
    if (lock.locked) expect(lock.survivor).toBe("partner");
  });
});
