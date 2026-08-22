import { useMemo, useState } from "react";

export function useClientTableSort<T, K extends string>(
  rows: T[],
  defaultKey: K,
  compare: (a: T, b: T, key: K) => number,
  defaultAsc = false,
) {
  const [sortKey, setSortKey] = useState<K>(defaultKey);
  const [sortAsc, setSortAsc] = useState(defaultAsc);

  const onSort = (key: K) => {
    if (sortKey === key) {
      setSortAsc((v) => !v);
    } else {
      setSortKey(key);
      setSortAsc(key === "name" || key === "description" || key === "title");
    }
  };

  const sorted = useMemo(() => {
    return rows.slice().sort((a, b) => {
      const cmp = compare(a, b, sortKey);
      if (cmp !== 0) return sortAsc ? cmp : -cmp;
      return 0;
    });
  }, [rows, sortKey, sortAsc, compare]);

  return { sorted, sortKey, sortAsc, onSort };
}
