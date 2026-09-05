import { invokeCorrelateSoldPurchased } from "@/lib/productValidation/invokeCorrelateSoldPurchased";
import type { ProductValidationResult } from "@/lib/productValidation/types";
import type { ProductSetupQueue } from "@/lib/productSetupQueue";
import { useEffect, useState } from "react";

export type ProductValidationSessionState = {
  running: boolean;
  result: ProductValidationResult | null;
  samePick: Record<string, string>;
  soldPick: Record<string, string>;
  recipePicks: Record<string, string[]>;
  generation: number;
};

type SessionRecord = ProductValidationSessionState;

const emptyState = (): ProductValidationSessionState => ({
  running: false,
  result: null,
  samePick: {},
  soldPick: {},
  recipePicks: {},
  generation: 0,
});

const sessions = new Map<string, SessionRecord>();
const listeners = new Map<string, Set<(state: ProductValidationSessionState) => void>>();

function notify(companyId: string, state: ProductValidationSessionState) {
  for (const listener of listeners.get(companyId) ?? []) listener(state);
}

export function getProductValidationSession(
  companyId: string,
): ProductValidationSessionState {
  return sessions.get(companyId) ?? emptyState();
}

export function subscribeProductValidationSession(
  companyId: string,
  listener: (state: ProductValidationSessionState) => void,
): () => void {
  const set = listeners.get(companyId) ?? new Set();
  set.add(listener);
  listeners.set(companyId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(companyId);
  };
}

export function patchProductValidationSession(
  companyId: string,
  patch:
    | Partial<ProductValidationSessionState>
    | ((prev: ProductValidationSessionState) => Partial<ProductValidationSessionState>),
): ProductValidationSessionState {
  const prev = getProductValidationSession(companyId);
  const next = {
    ...prev,
    ...(typeof patch === "function" ? patch(prev) : patch),
  };
  sessions.set(companyId, next);
  notify(companyId, next);
  return next;
}

export function defaultPicksFromResult(result: ProductValidationResult): Pick<
  ProductValidationSessionState,
  "samePick" | "soldPick" | "recipePicks"
> {
  const samePick: Record<string, string> = {};
  const soldPick: Record<string, string> = {};
  const recipePicks: Record<string, string[]> = {};
  for (const row of result.sameItem) {
    if (row.band !== "high") continue;
    const first = row.candidates[0]?.purchase.productId;
    if (first) samePick[row.id] = first;
    soldPick[row.id] = row.sold.productId;
  }
  for (const row of result.recipes) {
    if (row.band !== "high") continue;
    recipePicks[row.id] = row.ingredients.map(
      (ingredient) => ingredient.purchase.productId,
    );
  }
  return { samePick, soldPick, recipePicks };
}

export function beginProductValidationRun(companyId: string): number {
  const prev = getProductValidationSession(companyId);
  const generation = prev.generation + 1;
  patchProductValidationSession(companyId, { running: true, generation });
  return generation;
}

export function finishProductValidationRun(
  companyId: string,
  generation: number,
  outcome:
    | { ok: true; result: ProductValidationResult }
    | { ok: false },
): boolean {
  const current = getProductValidationSession(companyId);
  if (current.generation !== generation) return false;
  if (!outcome.ok) {
    patchProductValidationSession(companyId, { running: false });
    return true;
  }
  patchProductValidationSession(companyId, {
    running: false,
    result: outcome.result,
    ...defaultPicksFromResult(outcome.result),
  });
  return true;
}

export async function startProductValidationSession(input: {
  companyId: string;
  loadQueue: () => Promise<ProductSetupQueue>;
  correlate?: typeof invokeCorrelateSoldPurchased;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const current = getProductValidationSession(input.companyId);
  if (current.running) return { ok: true };

  const generation = beginProductValidationRun(input.companyId);
  const queue = await input.loadQueue();
  const correlated = await (input.correlate ?? invokeCorrelateSoldPurchased)({
    companyId: input.companyId,
    items: queue.items,
  });

  if (!correlated.ok) {
    finishProductValidationRun(input.companyId, generation, { ok: false });
    return { ok: false, error: correlated.error };
  }

  const applied = finishProductValidationRun(input.companyId, generation, {
    ok: true,
    result: correlated.result,
  });
  if (!applied) return { ok: true };
  return { ok: true };
}

export function useProductValidationSession(companyId: string) {
  const [state, setState] = useState(() => getProductValidationSession(companyId));

  useEffect(() => {
    setState(getProductValidationSession(companyId));
    return subscribeProductValidationSession(companyId, setState);
  }, [companyId]);

  return state;
}

export function resetProductValidationSessionsForTests() {
  sessions.clear();
  listeners.clear();
}
