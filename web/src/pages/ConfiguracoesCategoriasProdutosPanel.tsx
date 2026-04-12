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

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Package className="h-5 w-5" />
          Categorias de produtos
        </CardTitle>
        <CardDescription>
          Classifique itens do catálogo (organização interna). São independentes
          das categorias financeiras e do CMV. Você pode criar novas categorias
          aqui ou ao editar um produto.
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
            {rows.map((row) => (
              <li
                key={row.id}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-xl border border-border/80 bg-muted/20 px-3 py-2.5 text-sm",
                  !isOwner && "opacity-90",
                )}
              >
                <span className="min-w-0 font-medium leading-snug">
                  {row.name}
                </span>
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
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
