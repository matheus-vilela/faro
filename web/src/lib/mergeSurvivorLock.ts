export type MergeNameHolder = {
  merged_catalog_names?: string[] | null;
};

export type MergeSurvivorLock =
  | { locked: false }
  | {
      locked: true;
      survivor: "source" | "partner";
      reason: string;
    };

export function mergedCatalogNameCount(product: MergeNameHolder): number {
  return (product.merged_catalog_names ?? []).filter((name) =>
    Boolean(name?.trim()),
  ).length;
}

export function hasMergedCatalogItems(product: MergeNameHolder): boolean {
  return mergedCatalogNameCount(product) > 0;
}

export const MERGE_HUB_LOCK_REASON =
  "Este produto já tem outros cadastros unificados. Ele precisa permanecer no catálogo; o novo item é absorvido. Trocar quem fica perderia a referência correta.";

export function mergeSurvivorLock(
  source: MergeNameHolder,
  partner: MergeNameHolder | null,
): MergeSurvivorLock {
  if (!partner) return { locked: false };
  const sourceCount = mergedCatalogNameCount(source);
  const partnerCount = mergedCatalogNameCount(partner);
  if (sourceCount === 0 && partnerCount === 0) return { locked: false };
  if (sourceCount > partnerCount) {
    return {
      locked: true,
      survivor: "source",
      reason: MERGE_HUB_LOCK_REASON,
    };
  }
  return {
    locked: true,
    survivor: "partner",
    reason: MERGE_HUB_LOCK_REASON,
  };
}
