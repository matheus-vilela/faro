import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { useClientTableSort } from "@/hooks/useClientTableSort";
import { useSheetListView } from "@/hooks/useSheetListView";
import {
  scoreToneClass,
  type OverviewRankRow,
} from "@/lib/checklistOverview";
import { cn } from "@/lib/utils";
import { useState } from "react";

type RankSortKey = "name" | "done" | "score" | "prazo" | "completo" | "preciso";

function compareRank(a: OverviewRankRow, b: OverviewRankRow, key: RankSortKey) {
  if (key === "name") return a.name.localeCompare(b.name, "pt-BR");
  if (key === "done") {
    const ra = a.expected > 0 ? a.finished / a.expected : a.finished;
    const rb = b.expected > 0 ? b.finished / b.expected : b.finished;
    if (ra !== rb) return ra - rb;
    return a.finished - b.finished;
  }
  const va = a[key] ?? -1;
  const vb = b[key] ?? -1;
  return va - vb;
}

function ScorePill({ score }: { score: number | null }) {
  if (score == null) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  return (
    <span
      className={cn(
        "inline-flex min-w-10 items-center justify-center rounded-full px-2 py-0.5 text-sm font-bold tabular-nums",
        scoreToneClass(score),
      )}
    >
      {score}
    </span>
  );
}

function AxisVal({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  return <span className="tabular-nums">{value}</span>;
}

export function ChecklistRankingTable({
  rows,
  emptyLabel,
}: {
  rows: OverviewRankRow[];
  emptyLabel: string;
}) {
  const view = useSheetListView();
  const { sorted, sortKey, sortAsc, onSort } = useClientTableSort<
    OverviewRankRow,
    RankSortKey
  >(rows, "score", compareRank);
  const [openId, setOpenId] = useState<string | null>(null);
  const selected = rows.find((r) => r.memberId === openId) ?? null;

  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
        {emptyLabel}
      </p>
    );
  }

  return (
    <>
      {view === "cards" ? (
        <ul className="space-y-2">
          {sorted.map((r, i) => (
            <li key={r.memberId}>
              <button
                type="button"
                className="w-full rounded-xl border px-3 py-3 text-left text-sm transition-colors hover:bg-muted/40"
                onClick={() => setOpenId(r.memberId)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold leading-snug">
                      <span className="mr-1.5 text-muted-foreground">
                        {i + 1}º
                      </span>
                      {r.name}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                      {r.finished}/{r.expected} · Prazo {r.prazo ?? "—"} ·
                      Completo {r.completo ?? "—"} · Preciso {r.preciso ?? "—"}
                    </p>
                  </div>
                  <ScorePill score={r.score} />
                </div>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="border-b bg-muted/40 text-xs">
              <tr>
                <th className="w-10 px-3 py-2.5 font-medium text-muted-foreground">
                  #
                </th>
                <SortableTableHead
                  label="Operador"
                  column="name"
                  sortKey={sortKey}
                  sortAsc={sortAsc}
                  onSort={onSort}
                />
                <SortableTableHead
                  label="Feito"
                  column="done"
                  sortKey={sortKey}
                  sortAsc={sortAsc}
                  onSort={onSort}
                />
                <SortableTableHead
                  label="Nota"
                  column="score"
                  sortKey={sortKey}
                  sortAsc={sortAsc}
                  onSort={onSort}
                  align="right"
                />
                <SortableTableHead
                  label="Prazo"
                  column="prazo"
                  sortKey={sortKey}
                  sortAsc={sortAsc}
                  onSort={onSort}
                  align="right"
                />
                <SortableTableHead
                  label="Completo"
                  column="completo"
                  sortKey={sortKey}
                  sortAsc={sortAsc}
                  onSort={onSort}
                  align="right"
                />
                <SortableTableHead
                  label="Preciso"
                  column="preciso"
                  sortKey={sortKey}
                  sortAsc={sortAsc}
                  onSort={onSort}
                  align="right"
                />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr
                  key={r.memberId}
                  className="cursor-pointer border-b last:border-0 hover:bg-muted/30"
                  onClick={() => setOpenId(r.memberId)}
                >
                  <td className="px-3 py-2.5 text-muted-foreground tabular-nums">
                    {i + 1}
                  </td>
                  <td className="px-3 py-2.5 font-medium">{r.name}</td>
                  <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                    {r.finished}/{r.expected}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <ScorePill score={r.score} />
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <AxisVal value={r.prazo} />
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <AxisVal value={r.completo} />
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <AxisVal value={r.preciso} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Sheet open={!!selected} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent className="flex w-full flex-col overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{selected?.name ?? "Operador"}</SheetTitle>
            <SheetDescription>
              Qualidade no período (Prazo, Completo e Preciso) e atingimento da
              meta.
            </SheetDescription>
          </SheetHeader>
          {selected ? (
            <div className="flex flex-1 flex-col gap-5 px-4 pb-6">
              <div className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3">
                <div>
                  <p className="text-xs text-muted-foreground">Nota</p>
                  <div className="mt-1">
                    <ScorePill score={selected.score} />
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Feito / esperado</p>
                  <p className="mt-1 text-lg font-bold tabular-nums">
                    {selected.finished}/{selected.expected}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ["Prazo", selected.prazo],
                    ["Completo", selected.completo],
                    ["Preciso", selected.preciso],
                  ] as const
                ).map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-lg border bg-muted/20 px-3 py-2 text-center"
                  >
                    <p className="text-[11px] text-muted-foreground">{label}</p>
                    <p className="mt-0.5 text-lg font-semibold tabular-nums">
                      {value ?? "—"}
                    </p>
                  </div>
                ))}
              </div>
              <div className="rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">Como calculamos</p>
                <p>
                  <span className="font-medium text-foreground">Prazo</span> —
                  no horário (se não houver prazo, conta 100).
                </p>
                <p>
                  <span className="font-medium text-foreground">Completo</span>{" "}
                  — % de itens feitos naquele envio.
                </p>
                <p>
                  <span className="font-medium text-foreground">Preciso</span> —
                  100 se não foi devolvido; menor se está para refazer.
                </p>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium">Checklists</p>
                {selected.assignments.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Sem atribuições neste período.
                  </p>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {selected.assignments.map((a) => (
                      <li
                        key={a.checklistId}
                        className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                      >
                        <span className="min-w-0 truncate">{a.checklistTitle}</span>
                        <Badge variant="outline" className="tabular-nums">
                          {a.finished}/{a.expected}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpenId(null)}
              >
                Fechar
              </Button>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
