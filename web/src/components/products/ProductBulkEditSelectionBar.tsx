import { Button } from "@/components/ui/button";
import { BULK_EDIT_MAX_PRODUCTS } from "@/types/productBulkEdit";
import { ListFilter, Pencil, X } from "lucide-react";

export function ProductBulkEditSelectionBar({
  selectedCount,
  filteredCount,
  selectAllLoading,
  onSelectPage,
  onSelectAllFiltered,
  onClear,
  onEdit,
  pageFullySelected,
}: {
  selectedCount: number;
  filteredCount: number;
  selectAllLoading: boolean;
  onSelectPage: () => void;
  onSelectAllFiltered: () => void;
  onClear: () => void;
  onEdit: () => void;
  pageFullySelected: boolean;
}) {
  if (selectedCount === 0) return null;

  const overLimit = selectedCount > BULK_EDIT_MAX_PRODUCTS;

  return (
    <div
      className="mb-4 rounded-xl border-2 border-primary/30 bg-primary/[0.07] p-3 shadow-sm dark:border-primary/25 dark:bg-primary/10"
      role="region"
      aria-label="Ações em lote para produtos selecionados"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm"
            aria-hidden
          >
            <ListFilter className="h-5 w-5" />
          </div>
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-semibold leading-tight text-foreground">
              {selectedCount} produto(s) selecionado(s)
            </p>
            <p className="text-xs text-muted-foreground">
              {overLimit
                ? `Limite de ${BULK_EDIT_MAX_PRODUCTS} produtos por operação. Reduza a seleção.`
                : "Aplique a mesma alteração a todos ou limpe a seleção."}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!pageFullySelected ? (
            <Button type="button" variant="outline" size="sm" onClick={onSelectPage}>
              Selecionar página
            </Button>
          ) : null}
          {filteredCount > selectedCount ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={selectAllLoading}
              onClick={() => void onSelectAllFiltered()}
            >
              {selectAllLoading
                ? "Carregando…"
                : `Selecionar todos (${filteredCount})`}
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={onClear}>
            <X className="mr-1 h-3.5 w-3.5" />
            Limpar
          </Button>
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            disabled={overLimit}
            onClick={onEdit}
          >
            <Pencil className="h-3.5 w-3.5" />
            Editar em lote
          </Button>
        </div>
      </div>
    </div>
  );
}
