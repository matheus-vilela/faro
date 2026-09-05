import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { CompanyProductCategory } from "@/types/companyProductCategory";
import { Loader2, Package, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

export function ConfiguracoesCategoriasProdutosPanel({
  companyId,
  isOwner,
}: {
  companyId: string;
  isOwner: boolean;
}) {
  const [rows, setRows] = useState<CompanyProductCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("company_product_categories")
      .select("*")
      .eq("company_id", companyId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    setLoading(false);
    if (error) {
      toast.error("Erro ao carregar categorias de produto: " + error.message);
      setRows([]);
      return;
    }
    setRows((data ?? []) as CompanyProductCategory[]);
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    const name = newName.trim();
    if (!name || !isOwner) return;
    setAdding(true);
    const { error } = await supabase.from("company_product_categories").insert({
      company_id: companyId,
      name,
      sort_order: 9999,
    });
    setAdding(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Categoria criada.");
    setNewName("");
    void load();
  };

  const remove = async (row: CompanyProductCategory) => {
    if (!isOwner) return;
    const { error } = await supabase
      .from("company_product_categories")
      .delete()
      .eq("id", row.id)
      .eq("company_id", companyId);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Categoria removida.");
    void load();
  };

  const toggleExcludeFromSales = async (
    row: CompanyProductCategory,
    next: boolean,
  ) => {
    if (!isOwner) return;
    setTogglingId(row.id);
    const { error } = await supabase
      .from("company_product_categories")
      .update({ exclude_from_sales: next })
      .eq("id", row.id)
      .eq("company_id", companyId);
    setTogglingId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRows((prev) =>
      prev.map((r) =>
        r.id === row.id ? { ...r, exclude_from_sales: next } : r,
      ),
    );
  };

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Package className="h-5 w-5" />
          Categorias de produtos
        </CardTitle>
        <CardDescription>
          Classifique itens do catálogo (organização interna). São independentes
          das categorias financeiras e do CMV. Marque{" "}
          <span className="font-medium text-foreground">
            Não aparece como venda
          </span>{" "}
          para itens de uso interno (guardanapos, canudos): não entram em
          campeões, calendário de vendas nem na correlação de venda. Se o
          produto estiver em qualquer categoria marcada, ele deixa de contar
          como venda.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isOwner ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-2">
              <Label htmlFor="nova-cat-produto">Nova categoria</Label>
              <Input
                id="nova-cat-produto"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ex.: Frios, Bebidas geladas…"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void add();
                }}
              />
            </div>
            <Button
              type="button"
              className="shrink-0"
              disabled={adding || !newName.trim()}
              onClick={() => void add()}
            >
              {adding ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Adicionar
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Apenas o proprietário pode criar ou remover categorias.
          </p>
        )}

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando…
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma categoria cadastrada.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {rows.map((row) => {
              const excluded = row.exclude_from_sales === true;
              return (
                <li
                  key={row.id}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-sm",
                    excluded
                      ? "border-amber-500/40 bg-amber-500/8"
                      : "border-border/80 bg-muted/20",
                    !isOwner && "opacity-90",
                  )}
                >
                  <span className="min-w-0 font-medium leading-snug">
                    {row.name}
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-1.5">
                          <Switch
                            checked={excluded}
                            disabled={!isOwner || togglingId === row.id}
                            onCheckedChange={(next) =>
                              void toggleExcludeFromSales(row, next)
                            }
                            aria-label={`Não aparece como venda: ${row.name}`}
                          />
                          <span className="hidden text-[11px] leading-tight text-muted-foreground sm:inline">
                            Não é venda
                          </span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        Não aparece como venda — itens desta categoria não
                        entram em vendas, campeões nem correlação.
                      </TooltipContent>
                    </Tooltip>
                    {isOwner ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        aria-label={`Remover ${row.name}`}
                        onClick={() => void remove(row)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
