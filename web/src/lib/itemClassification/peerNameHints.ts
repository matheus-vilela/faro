import type { OperationalItemType } from "@/lib/itemClassification/operationalItemTypes";
import type { CategoryScores } from "@/lib/itemClassification/hospitalityLexicon";

function bump(
  s: CategoryScores,
  t: keyof CategoryScores,
  add: number,
): CategoryScores {
  return { ...s, [t]: Math.min(0.99, (s[t] ?? 0) + add) };
}

/**
 * Soma o “histórico” da unidade: quando 2+ itens com o mesmo nome apontam o mesmo
 * `OperationalItemType` (dados vêm do merge em `StepItemClassificationForm`).
 */
export function applyPeerTalliesToScores(
  scores: CategoryScores,
  peer: Partial<Record<OperationalItemType, number>> | undefined,
): { next: CategoryScores; peerLabel?: string } {
  if (!peer) return { next: scores };
  const entries = (Object.keys(peer) as OperationalItemType[]).map(
    (k) => [k, peer[k] ?? 0] as const,
  );
  entries.sort((a, b) => b[1] - a[1]);
  const [type, n] = entries[0] ?? [undefined, 0];
  if (!type || n < 2) return { next: scores };
  const add = 0.1 * Math.min(4, n);
  return {
    next: bump(scores, type as keyof CategoryScores, add),
    peerLabel: `histórico: ${n} itens com este nome apontam para ${type}`,
  };
}

/**
 * Confirmações anteriores para o mesmo rótulo normalizado (`company_item_classification_learning`).
 * Uma ocorrência já reforça; a força cresce até ~5.
 */
export function applyLearningTalliesToScores(
  scores: CategoryScores,
  learning: Partial<Record<OperationalItemType, number>> | undefined,
): { next: CategoryScores; learningLabel?: string } {
  if (!learning) return { next: scores };
  const entries = (Object.keys(learning) as OperationalItemType[]).map(
    (k) => [k, learning[k] ?? 0] as const,
  );
  entries.sort((a, b) => b[1] - a[1]);
  const [type, n] = entries[0] ?? [undefined, 0];
  if (!type || n < 1) return { next: scores };
  const add = 0.1 * Math.min(5, n);
  return {
    next: bump(scores, type as keyof CategoryScores, add),
    learningLabel: `aprendizado: ${n} confirmação(ões) para o mesmo rótulo → ${String(type)}`,
  };
}
