import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { useClientTableSort } from "@/hooks/useClientTableSort";
import { useSheetListView } from "@/hooks/useSheetListView";
import {
  formatRecurrenceSummary,
  type ChecklistRecurrenceMeta,
} from "@/lib/checklistRecurrence";
import { Pencil, Trash2, Users } from "lucide-react";

export type CatalogAssignee = { id: string; name: string };

export type CatalogChecklist = {
  id: string;
  title: string;
  active: boolean;
  recurrence: ChecklistRecurrenceMeta;
};

type CatalogSortKey = "title" | "assignees" | "recurrence" | "active";

type CatalogRow = CatalogChecklist & {
  assignees: CatalogAssignee[];
  recurrenceLabel: string;
};

function GenerateLinkButton({
  assignees,
  onGenerate,
}: {
  assignees: CatalogAssignee[];
  onGenerate: (memberId: string) => void;
}) {
  if (assignees.length === 0) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled
        title="Atribua um operador a este checklist"
      >
        Gerar link
      </Button>
    );
  }
  if (assignees.length === 1) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onGenerate(assignees[0]!.id)}
      >
        Link · {assignees[0]!.name}
      </Button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          Gerar link
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {assignees.map((m) => (
          <DropdownMenuItem key={m.id} onClick={() => onGenerate(m.id)}>
            {m.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AssigneeBadges({ assignees }: { assignees: CatalogAssignee[] }) {
  if (assignees.length === 0) {
    return (
      <Badge variant="outline" className="font-normal text-muted-foreground">
        Sem operador
      </Badge>
    );
  }
  const shown = assignees.slice(0, 3);
  const extra = assignees.length - shown.length;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((m) => (
        <Badge key={m.id} variant="secondary" className="max-w-[11rem] font-normal">
          <Users className="size-3 opacity-70" />
          <span className="truncate">{m.name}</span>
        </Badge>
      ))}
      {extra > 0 ? (
        <Badge variant="outline" className="font-normal tabular-nums">
          +{extra}
        </Badge>
      ) : null}
    </div>
  );
}

function compareCatalog(a: CatalogRow, b: CatalogRow, key: CatalogSortKey) {
  if (key === "title") return a.title.localeCompare(b.title, "pt-BR");
  if (key === "assignees") {
    const sa = a.assignees.map((m) => m.name).join(", ");
    const sb = b.assignees.map((m) => m.name).join(", ");
    if (!sa && sb) return 1;
    if (sa && !sb) return -1;
    return sa.localeCompare(sb, "pt-BR");
  }
  if (key === "recurrence") {
    return a.recurrenceLabel.localeCompare(b.recurrenceLabel, "pt-BR");
  }
  return Number(a.active) - Number(b.active);
}

function RowActions({
  row,
  onGenerate,
  onEdit,
  onRemove,
}: {
  row: CatalogRow;
  onGenerate: (checklistId: string, memberId: string) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
      <GenerateLinkButton
        assignees={row.assignees}
        onGenerate={(memberId) => onGenerate(row.id, memberId)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => onEdit(row.id)}
        aria-label={`Editar ${row.title}`}
      >
        <Pencil className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => onRemove(row.id)}
        aria-label={`Excluir ${row.title}`}
      >
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}

export function ChecklistCatalogList({
  checklists,
  assignedByChecklist,
  onGenerate,
  onEdit,
  onRemove,
}: {
  checklists: CatalogChecklist[];
  assignedByChecklist: Record<string, CatalogAssignee[]>;
  onGenerate: (checklistId: string, memberId: string) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const view = useSheetListView();
  const catalogRows: CatalogRow[] = checklists.map((c) => ({
    ...c,
    assignees: assignedByChecklist[c.id] ?? [],
    recurrenceLabel: formatRecurrenceSummary(c.recurrence),
  }));
  const { sorted, sortKey, sortAsc, onSort } = useClientTableSort<
    CatalogRow,
    CatalogSortKey
  >(catalogRows, "title", compareCatalog, true);

  if (view === "cards") {
    return (
      <ul className="space-y-2">
        {sorted.map((r) => (
          <li key={r.id} className="rounded-xl border p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium leading-snug">{r.title}</p>
              <Badge variant={r.active ? "secondary" : "outline"}>
                {r.active ? "Ativo" : "Inativo"}
              </Badge>
            </div>
            <div className="mt-2">
              <AssigneeBadges assignees={r.assignees} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {r.recurrenceLabel}
            </p>
            <div className="mt-3">
              <RowActions
                row={r}
                onGenerate={onGenerate}
                onEdit={onEdit}
                onRemove={onRemove}
              />
            </div>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-xs font-medium text-muted-foreground">
            <SortableTableHead
              label="Checklist"
              column="title"
              sortKey={sortKey}
              sortAsc={sortAsc}
              onSort={onSort}
            />
            <SortableTableHead
              label="Operadores"
              column="assignees"
              sortKey={sortKey}
              sortAsc={sortAsc}
              onSort={onSort}
            />
            <SortableTableHead
              label="Quando"
              column="recurrence"
              sortKey={sortKey}
              sortAsc={sortAsc}
              onSort={onSort}
            />
            <SortableTableHead
              label="Status"
              column="active"
              sortKey={sortKey}
              sortAsc={sortAsc}
              onSort={onSort}
            />
            <th className="px-3 py-2.5 font-medium">Ações</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id} className="border-b border-border/60 last:border-0">
              <td className="px-3 py-2.5 font-medium">{r.title}</td>
              <td className="px-3 py-2.5">
                <AssigneeBadges assignees={r.assignees} />
              </td>
              <td className="px-3 py-2.5 text-muted-foreground">
                {r.recurrenceLabel}
              </td>
              <td className="px-3 py-2.5">
                <Badge variant={r.active ? "secondary" : "outline"}>
                  {r.active ? "Ativo" : "Inativo"}
                </Badge>
              </td>
              <td className="px-3 py-2.5">
                <RowActions
                  row={r}
                  onGenerate={onGenerate}
                  onEdit={onEdit}
                  onRemove={onRemove}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
