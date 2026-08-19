import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { boletoReconTitle } from "@/lib/boletoFluxoDescription";
import { cn } from "@/lib/utils";
import type { Boleto } from "@/types/expense";
import { Loader2, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

function formatCurrency(v: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(v);
}

function formatDateShort(ymd: string) {
  const s = ymd.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return ymd;
  const [, m, d] = s.split("-");
  return `${d}/${m}`;
}

export function AssociateBoletoDialog({
  open,
  onOpenChange,
  loading,
  confirming,
  boletos,
  onSearch,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  confirming: boolean;
  boletos: Boleto[];
  onSearch: (query: string) => void;
  onSelect: (boleto: Boleto) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const delay = query.trim() ? 250 : 0;
    const t = window.setTimeout(() => onSearch(query), delay);
    return () => window.clearTimeout(t);
  }, [query, open, onSearch]);

  const selected = useMemo(
    () => boletos.find((b) => b.id === selectedId) ?? null,
    [boletos, selectedId],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setQuery("");
          setSelectedId(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Associar a um lançamento existente</DialogTitle>
          <DialogDescription>
            Busque pelo nome, valor ou data e confirme o vínculo com o movimento
            do extrato.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            placeholder="Buscar lançamento…"
            className="pl-8"
            autoFocus
          />
        </div>
        <div className="max-h-72 overflow-y-auto rounded-md border">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : boletos.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              Nenhum lançamento encontrado.
            </p>
          ) : (
            <ul className="divide-y">
              {boletos.map((b) => {
                const active = b.id === selectedId;
                return (
                  <li key={b.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(b.id)}
                      className={cn(
                        "flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted/60",
                        active && "bg-primary/10",
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {boletoReconTitle(b)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDateShort(b.paid_at || b.due_date)}
                          {b.flow_type === "receivable"
                            ? " · a receber"
                            : " · a pagar"}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums font-medium">
                        {formatCurrency(Number(b.amount))}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            disabled={!selected || confirming}
            onClick={() => {
              if (!selected) return;
              onSelect(selected);
            }}
          >
            {confirming ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : null}
            Associar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
