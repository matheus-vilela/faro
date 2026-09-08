import { describe, expect, it } from "vitest";
import {
  activeCountStatusLabel,
  activeSessionsForListing,
  listingActiveStatusById,
  listingHasPendingApproval,
  shouldAskToReuseCount,
  slugFromCountShortLinks,
  splitListingsForCountMode,
  type InventoryCountSessionSummary,
} from "./createSession";

function sess(
  partial: Partial<InventoryCountSessionSummary> &
    Pick<InventoryCountSessionSummary, "id" | "status">,
): InventoryCountSessionSummary {
  return {
    kind: "regular",
    inventory_count_listing_id: "list-a",
    created_at: "2026-09-07T23:40:00.000Z",
    token: "tok",
    ...partial,
  };
}

describe("activeSessionsForListing", () => {
  it("só devolve open/returned da listagem, mais recente primeiro", () => {
    const rows = [
      sess({ id: "old", status: "open", created_at: "2026-09-07T23:38:00.000Z" }),
      sess({ id: "new", status: "returned", created_at: "2026-09-07T23:40:00.000Z" }),
      sess({
        id: "other",
        status: "open",
        inventory_count_listing_id: "list-b",
      }),
      sess({ id: "pending", status: "pending_approval" }),
    ];
    const active = activeSessionsForListing(rows, "list-a");
    expect(active.map((s) => s.id)).toEqual(["new", "old"]);
  });
});

describe("listingActiveStatusById", () => {
  it("usa o status da sessão ativa mais recente", () => {
    const map = listingActiveStatusById([
      sess({ id: "a", status: "open", created_at: "2026-09-07T23:38:00.000Z" }),
      sess({
        id: "b",
        status: "returned",
        created_at: "2026-09-07T23:40:00.000Z",
      }),
      sess({ id: "p", status: "pending_approval" }),
    ]);
    expect(map.get("list-a")).toBe("returned");
    expect(map.size).toBe(1);
  });

  it("ignora pending_approval e pega a ativa mais recente", () => {
    const map = listingActiveStatusById([
      sess({
        id: "p",
        status: "pending_approval",
        created_at: "2026-09-07T23:50:00.000Z",
      }),
      sess({ id: "o", status: "open", created_at: "2026-09-07T23:40:00.000Z" }),
    ]);
    expect(map.get("list-a")).toBe("open");
  });
});

describe("listingHasPendingApproval", () => {
  it("detecta conferência pendente da mesma listagem", () => {
    expect(
      listingHasPendingApproval(
        [sess({ id: "p", status: "pending_approval" })],
        "list-a",
      ),
    ).toBe(true);
    expect(
      listingHasPendingApproval([sess({ id: "o", status: "open" })], "list-a"),
    ).toBe(false);
  });
});

describe("activeCountStatusLabel", () => {
  it("distingue recontagem de em andamento", () => {
    expect(activeCountStatusLabel("returned")).toBe("Recontagem");
    expect(activeCountStatusLabel("open")).toBe("Em andamento");
  });
});

describe("slugFromCountShortLinks", () => {
  it("lê slug de embed array ou objeto", () => {
    expect(slugFromCountShortLinks([{ slug: "abc12345" }])).toBe("abc12345");
    expect(slugFromCountShortLinks({ slug: "xyz" })).toBe("xyz");
    expect(slugFromCountShortLinks([])).toBe(null);
  });
});

describe("shouldAskToReuseCount / splitListingsForCountMode", () => {
  const rows = [
    sess({ id: "open-a", status: "open", inventory_count_listing_id: "a" }),
    sess({ id: "open-c", status: "returned", inventory_count_listing_id: "c" }),
  ];

  it("não pergunta quando nenhuma listagem tem sessão ativa", () => {
    expect(shouldAskToReuseCount(["b"], rows)).toBe(false);
  });

  it("pergunta quando alguma listagem já está aberta", () => {
    expect(shouldAskToReuseCount(["a", "b"], rows)).toBe(true);
  });

  it("no modo reuso, continua as ativas e só cria as que faltam", () => {
    expect(splitListingsForCountMode(["a", "b", "c"], rows, "reuse-and-fill")).toEqual({
      reuseIds: ["a", "c"],
      createIds: ["b"],
    });
  });

  it("começar nova / abrir tudo cria para todas", () => {
    expect(splitListingsForCountMode(["a", "b"], rows, "create-all")).toEqual({
      reuseIds: [],
      createIds: ["a", "b"],
    });
  });
});
