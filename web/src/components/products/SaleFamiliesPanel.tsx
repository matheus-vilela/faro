import { EpocEstoqueVsVendasPanel } from "@/components/desenvolvimento/EpocEstoqueVsVendasCard";
import { SaleFamilyLinkSheet } from "@/components/products/SaleFamilyLinkSheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { SortableTableHead } from "@/components/ui/sortable-table-head";
import { useClientTableSort } from "@/hooks/useClientTableSort";
import {
  fetchSaleFamilyCandidates,
  fetchSaleFamilyRows,
  promoteProductToSaleFamily,
  type SaleFamilyListRow,
  type SaleFamilyProductOption,
} from "@/lib/productSaleFamily";
import { Layers, Loader2, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ProductSaleFamilySection } from "./ProductSaleFamilySection";

type SortKey = "name" | "sku" | "variants";

export function SaleFamiliesPanel({ companyId }: { companyId: string }) {
  const [rows, setRows] = useState<SaleFamilyListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [linkOpen, setLinkOpen] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [promoteId, setPromoteId] = useState("");
  const [promoteBusy, setPromoteBusy] = useState(false);
  const [candidates, setCandidates] = useState<SaleFamilyProductOption[]>([]);
  const [openFamily, setOpenFamily] = useState<SaleFamilyListRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchSaleFamilyRows(companyId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao listar famílias.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!promoteOpen) return;
    void fetchSaleFamilyCandidates(companyId, []).then((opts) =>
      setCandidates(opts.filter((p) => p.stock_control_type !== "SALE_FAMILY")),
    );
  }, [promoteOpen, companyId]);

  const { sorted, sortKey, sortAsc, onSort } = useClientTableSort<
    SaleFamilyListRow,
    SortKey
  >(
    rows,
    "name",
    (a, b, key) => {
      if (key === "sku") {
        return (a.sku ?? "").localeCompare(b.sku ?? "", "pt-BR", {
          numeric: true,
        });
      }
      if (key === "variants") return a.members.length - b.members.length;
      return a.name.localeCompare(b.name, "pt-BR");
    },
    true,
  );

  const promote = async () => {
    if (!promoteId) {
      toast.error("Escolha o item de cardápio.");
      return;
    }
    setPromoteBusy(true);
    try {
      await promoteProductToSaleFamily(promoteId);
      toast.success("Produto virou família de venda.");
      setPromoteOpen(false);
      setPromoteId("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível promover.");
    } finally {
      setPromoteBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Layers className="size-4" />
              Famílias de venda
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Item de cardápio (ex.: Bolinhos) + variantes de estoque (carne,
              cupim). A venda não baixa o cardápio. Não é ficha técnica.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPromoteOpen(true)}
            >
              Tornar item em família
            </Button>
            <Button type="button" size="sm" onClick={() => setLinkOpen(true)}>
              <Plus className="size-3.5" />
              Vincular variante
            </Button>
          </div>
        </div>

        {loading ? (
          <p className="text-muted-foreground text-sm">Carregando…</p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nenhuma família ainda. Transforme um produto da venda (Bolinhos) ou
            vincule uma variante — o alvo vira família automaticamente.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <SortableTableHead
                    label="Família"
                    column="name"
                    sortKey={sortKey}
                    sortAsc={sortAsc}
                    onSort={onSort}
                  />
                  <SortableTableHead
                    label="SKU"
                    column="sku"
                    sortKey={sortKey}
                    sortAsc={sortAsc}
                    onSort={onSort}
                  />
                  <SortableTableHead
                    label="Variantes"
                    column="variants"
                    sortKey={sortKey}
                    sortAsc={sortAsc}
                    onSort={onSort}
                    align="right"
                  />
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => (
                  <tr
                    key={row.id}
                    className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-muted/40"
                    onClick={() => setOpenFamily(row)}
                  >
                    <td className="px-3 py-2.5 font-medium">{row.name}</td>
                    <td className="text-muted-foreground px-3 py-2.5 font-mono text-xs">
                      {row.sku || "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {row.members.length}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">Estoque vs vendas do dia</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Cruza a venda de produtos EPOC com as saídas de estoque. Use para
            ligar o que só apareceu no estoque e aplicar baixas do dia.
          </p>
        </div>
        <EpocEstoqueVsVendasPanel />
      </section>

      <SaleFamilyLinkSheet
        open={linkOpen}
        onOpenChange={setLinkOpen}
        companyId={companyId}
        onLinked={() => void load()}
      />

      <AlertDialog open={promoteOpen} onOpenChange={setPromoteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tornar item em família de venda</AlertDialogTitle>
            <AlertDialogDescription>
              A venda desse produto passa a gerar só receita. Estoque sai pelas
              variantes ligadas, no relatório do dia. Não é ficha técnica.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5 px-1">
            <Label>Produto do cardápio</Label>
            <SearchSelect
              value={promoteId}
              onValueChange={setPromoteId}
              placeholder="Ex.: Bolinhos"
              searchPlaceholder="Buscar…"
              disabled={promoteBusy}
              options={candidates.map((p) => ({
                value: p.id,
                label: p.name,
                description: p.sku ? `SKU ${p.sku}` : undefined,
                keywords: p.sku ?? "",
              }))}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={promoteBusy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={promoteBusy}
              onClick={(e) => {
                e.preventDefault();
                void promote();
              }}
            >
              {promoteBusy ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : null}
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sheet
        open={openFamily != null}
        onOpenChange={(open) => {
          if (!open) setOpenFamily(null);
        }}
      >
        <SheetContent className="flex flex-col">
          <SheetHeader>
            <SheetTitle>{openFamily?.name ?? "Família de venda"}</SheetTitle>
            <SheetDescription>
              Variantes ligadas a este item de cardápio.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {openFamily ? (
              <ProductSaleFamilySection
                companyId={companyId}
                productId={openFamily.id}
                productName={openFamily.name}
                stockControlType="SALE_FAMILY"
                onChanged={() => void load()}
              />
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
