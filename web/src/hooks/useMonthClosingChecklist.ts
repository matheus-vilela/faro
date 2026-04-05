import type { MonthYear } from "@/components/MonthSelector";
import type { DreComputed } from "@/lib/dre/computeDre";
import type { CategoryTotals } from "@/lib/dre/computeDre";
import {
  allItemsDone,
  buildChecklistItems,
  countDone,
  deriveClosingChecklistAmounts,
  loadMonthClosePersisted,
  monthKeyFromPeriod,
  type ChecklistItemState,
  type MonthClosePersistedV1,
  type MonthClosingItemId,
  saveMonthClosePersisted,
} from "@/lib/monthClosingChecklist";
import type { CompanyCategory } from "@/types/category";
import { useCallback, useEffect, useMemo, useState } from "react";

function toPersisted(
  items: ChecklistItemState[],
  base: Pick<
    MonthClosePersistedV1,
    "isClosed" | "closedAt" | "closedBy" | "reopenReason" | "lastReopenAt"
  >,
): MonthClosePersistedV1 {
  const itemSnapshots: MonthClosePersistedV1["itemSnapshots"] = {};
  for (const it of items) {
    itemSnapshots[it.id] = {
      status: it.status,
      confirmedAt: it.confirmedAt,
      confirmedBy: it.confirmedBy,
    };
  }
  return {
    version: 1,
    ...base,
    itemSnapshots,
  };
}

export function useMonthClosingChecklist(
  companyId: string | undefined,
  period: MonthYear,
  computed: DreComputed | null,
  categoryTotals: CategoryTotals,
  categories: CompanyCategory[],
  userLabel: string | null,
) {
  const monthKey = monthKeyFromPeriod(period);
  const [persisted, setPersisted] = useState<MonthClosePersistedV1 | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setPersisted(loadMonthClosePersisted(companyId, monthKey));
    setHydrated(true);
  }, [companyId, monthKey]);

  const amounts = useMemo(
    () => deriveClosingChecklistAmounts(computed, categoryTotals, categories),
    [computed, categoryTotals, categories],
  );

  const items = useMemo(() => {
    const closed = persisted?.isClosed ?? false;
    return buildChecklistItems(amounts, persisted, closed);
  }, [amounts, persisted]);

  const updateItems = useCallback(
    (updater: (prev: ChecklistItemState[]) => ChecklistItemState[]) => {
      setPersisted((prev) => {
        const base = prev ?? {
          version: 1 as const,
          isClosed: false,
          closedAt: null,
          closedBy: null,
          reopenReason: null,
          lastReopenAt: null,
          itemSnapshots: {},
        };
        const built = buildChecklistItems(
          amounts,
          base,
          base.isClosed,
        );
        const nextItems = updater(built);
        const next = toPersisted(nextItems, {
          isClosed: base.isClosed,
          closedAt: base.closedAt,
          closedBy: base.closedBy,
          reopenReason: base.reopenReason,
          lastReopenAt: base.lastReopenAt,
        });
        saveMonthClosePersisted(companyId, monthKey, next);
        return next;
      });
    },
    [amounts, companyId, monthKey],
  );

  const confirmValue = useCallback(
    (id: MonthClosingItemId) => {
      const now = new Date().toISOString();
      const by = userLabel;
      updateItems((list) =>
        list.map((it) =>
          it.id === id
            ? {
                ...it,
                status: "confirmed" as const,
                confirmedAt: now,
                confirmedBy: by,
              }
            : it,
        ),
      );
    },
    [updateItems, userLabel],
  );

  const confirmNoValue = useCallback(
    (id: MonthClosingItemId) => {
      const now = new Date().toISOString();
      const by = userLabel;
      updateItems((list) =>
        list.map((it) =>
          it.id === id
            ? {
                ...it,
                status: "no_value_confirmed" as const,
                confirmedAt: now,
                confirmedBy: by,
              }
            : it,
        ),
      );
    },
    [updateItems, userLabel],
  );

  const undoItem = useCallback(
    (id: MonthClosingItemId) => {
      updateItems((list) =>
        list.map((it) => {
          if (it.id !== id) return it;
          const nextStatus = it.hasValue ? ("pending" as const) : ("missing" as const);
          return {
            ...it,
            status: nextStatus,
            confirmedAt: null,
            confirmedBy: null,
          };
        }),
      );
    },
    [updateItems],
  );

  const closeMonth = useCallback(() => {
    const now = new Date().toISOString();
    const by = userLabel;
    setPersisted((prev) => {
      const base: MonthClosePersistedV1 =
        prev ?? {
          version: 1,
          isClosed: false,
          closedAt: null,
          closedBy: null,
          reopenReason: null,
          lastReopenAt: null,
          itemSnapshots: {},
        };
      const built = buildChecklistItems(amounts, base, false);
      if (!allItemsDone(built)) return prev ?? null;
      const closedItems = built.map((it) => ({
        ...it,
        status: it.hasValue
          ? ("confirmed" as const)
          : ("no_value_confirmed" as const),
        confirmedAt: it.confirmedAt ?? now,
        confirmedBy: it.confirmedBy ?? by,
      }));
      const next = toPersisted(closedItems, {
        isClosed: true,
        closedAt: now,
        closedBy: by,
        reopenReason: base.reopenReason,
        lastReopenAt: base.lastReopenAt,
      });
      saveMonthClosePersisted(companyId, monthKey, next);
      return next;
    });
  }, [amounts, companyId, monthKey, userLabel]);

  const reopenMonth = useCallback(
    (reason: string) => {
      const now = new Date().toISOString();
      setPersisted(() => {
        const fresh = buildChecklistItems(
          amounts,
          null,
          false,
        ).map((it) => ({
          ...it,
          confirmedAt: null,
          confirmedBy: null,
        }));
        const next = toPersisted(fresh, {
          isClosed: false,
          closedAt: null,
          closedBy: null,
          reopenReason: reason.trim() || null,
          lastReopenAt: now,
        });
        saveMonthClosePersisted(companyId, monthKey, next);
        return next;
      });
    },
    [amounts, companyId, monthKey],
  );

  const doneCount = countDone(items);
  const canClose = allItemsDone(items) && !(persisted?.isClosed ?? false);

  return {
    hydrated,
    monthKey,
    items,
    amounts,
    isClosed: persisted?.isClosed ?? false,
    closedAt: persisted?.closedAt ?? null,
    closedBy: persisted?.closedBy ?? null,
    reopenReason: persisted?.reopenReason ?? null,
    lastReopenAt: persisted?.lastReopenAt ?? null,
    doneCount,
    canClose,
    confirmValue,
    confirmNoValue,
    undoItem,
    closeMonth,
    reopenMonth,
  };
}
