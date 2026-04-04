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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { supabase } from "@/lib/supabase";
import type { Product } from "@/types/product";
import { ChefHat, Loader2, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

type IngRow = { product_id: string; quantity: string };

type RecipeRow = {
  id: string;
  name: string;
  batch_yield: number;
  active: boolean;
  output_product_id: string | null;
  recipe_ingredients: {
    id: string;
    product_id: string;
    quantity: number;
    products: { name: string; unit: string } | null;
  }[];
};

export function EstoqueReceitasPanel({ companyId }: { companyId: string }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [recipes, setRecipes] = useState<RecipeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [batchYield, setBatchYield] = useState("1");
  const [outputId, setOutputId] = useState<string>("");
  const [ings, setIngs] = useState<IngRow[]>([
    { product_id: "", quantity: "1" },
  ]);
  const [consumeRecipe, setConsumeRecipe] = useState<string>("");
  const [portions, setPortions] = useState("1");
  const [consuming, setConsuming] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [p, r] = await Promise.all([
      supabase
        .from("products")
        .select("*")
        .eq("company_id", companyId)
        .or("is_active.is.null,is_active.eq.true")
        .order("name"),
      supabase
        .from("recipes")
        .select(
          "id, name, batch_yield, active, output_product_id, recipe_ingredients(id, product_id, quantity, products(name, unit))",
        )
        .eq("company_id", companyId)
        .order("name"),
    ]);
    setLoading(false);
    setProducts((p.data ?? []) as Product[]);
    setRecipes((r.data ?? []) as unknown as RecipeRow[]);
  }, [companyId]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const saveRecipe = async () => {
    const t = name.trim();
    if (!t) {
      toast.error("Informe o nome da receita.");
      return;
    }
    const y = parseFloat(batchYield);
    if (Number.isNaN(y) || y <= 0) {
      toast.error("Rendimento da receita inválido.");
      return;
    }
    const validIngs = ings.filter(
      (x) =>
        x.product_id &&
        parseFloat(x.quantity) > 0 &&
        !Number.isNaN(parseFloat(x.quantity)),
    );
    if (validIngs.length === 0) {
      toast.error("Adicione ao menos um ingrediente.");
      return;
    }

    setSaving(true);
    const { data: rec, error: re } = await supabase
      .from("recipes")
      .insert({
        company_id: companyId,
        name: t,
        batch_yield: y,
        output_product_id: outputId || null,
        active: true,
      })
      .select("id")
      .single();

    if (re || !rec?.id) {
      console.error(re);
      toast.error("Não foi possível salvar a receita.");
      setSaving(false);
      return;
    }

    const rid = rec.id as string;
    const rows = validIngs.map((x) => ({
      recipe_id: rid,
      product_id: x.product_id,
      quantity: parseFloat(x.quantity),
    }));

    const { error: ie } = await supabase.from("recipe_ingredients").insert(rows);
    setSaving(false);
    if (ie) {
      console.error(ie);
      await supabase.from("recipes").delete().eq("id", rid);
      toast.error("Falha ao salvar ingredientes.");
      return;
    }
    toast.success("Receita criada.");
    setSheetOpen(false);
    setName("");
    setBatchYield("1");
    setOutputId("");
    setIngs([{ product_id: "", quantity: "1" }]);
    void load();
  };

  const consume = async () => {
    if (!consumeRecipe) {
      toast.error("Selecione uma receita.");
      return;
    }
    const n = parseFloat(portions);
    if (Number.isNaN(n) || n <= 0) {
      toast.error("Informe a quantidade de porções.");
      return;
    }
    setConsuming(true);
    const { data, error } = await supabase.rpc("consume_recipe_stock", {
      p_recipe_id: consumeRecipe,
      p_portions: n,
    });
    setConsuming(false);
    const row = data as { ok?: boolean; error?: string };
    if (error || !row?.ok) {
      toast.error(
        row?.error === "forbidden"
          ? "Sem permissão."
          : "Não foi possível baixar o estoque (verifique saldos).",
      );
      return;
    }
    toast.success("Estoque dos ingredientes atualizado.");
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ChefHat className="h-4 w-4" />
              Receitas (fichas técnicas)
            </CardTitle>
            <CardDescription>
              Cadastre ingredientes por lote (rendimento) e depois use a baixa
              por porções para descontar insumos do estoque conforme o preparo.
            </CardDescription>
          </div>
          <Button type="button" size="sm" onClick={() => setSheetOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Nova receita
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando…
            </div>
          ) : recipes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma receita cadastrada.
            </p>
          ) : (
            <ul className="space-y-3">
              {recipes.map((r) => (
                <li
                  key={r.id}
                  className="rounded-lg border border-border/80 p-3 text-sm"
                >
                  <p className="font-medium">{r.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Rendimento base: {Number(r.batch_yield).toLocaleString("pt-BR")}{" "}
                    porção(ões)
                    {!r.active ? " · inativa" : ""}
                  </p>
                  <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
                    {r.recipe_ingredients?.map((i) => (
                      <li key={i.id}>
                        {i.products?.name ?? "—"}:{" "}
                        {Number(i.quantity).toLocaleString("pt-BR")}{" "}
                        {i.products?.unit} / lote
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Baixa por preparo</CardTitle>
          <CardDescription>
            Informe quantas porções foram produzidas; o sistema desconta os
            insumos proporcionalmente ao rendimento cadastrado.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-2">
            <Label>Receita</Label>
            <Select
              value={consumeRecipe || "__"}
              onValueChange={(v) =>
                setConsumeRecipe(v === "__" ? "" : v)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecionar" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__">—</SelectItem>
                {recipes
                  .filter((r) => r.active)
                  .map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-full space-y-2 sm:w-36">
            <Label>Porções</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={portions}
              onChange={(e) => setPortions(e.target.value)}
            />
          </div>
          <Button
            type="button"
            disabled={consuming}
            onClick={() => void consume()}
          >
            {consuming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Baixar estoque"
            )}
          </Button>
        </CardContent>
      </Card>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Nova receita</SheetTitle>
          </SheetHeader>
          <div className="flex flex-1 flex-col gap-4 px-4 pb-2">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Rendimento (porções por lote)</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                value={batchYield}
                onChange={(e) => setBatchYield(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Produto de saída (opcional)</Label>
              <Select
                value={outputId || "__none__"}
                onValueChange={(v) =>
                  setOutputId(v === "__none__" ? "" : v)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Nenhum</SelectItem>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Ingredientes (por lote)</Label>
              {ings.map((row, i) => (
                <div key={i} className="flex gap-2">
                  <Select
                    value={row.product_id || "__"}
                    onValueChange={(v) => {
                      const n = [...ings];
                      n[i] = { ...n[i]!, product_id: v === "__" ? "" : v };
                      setIngs(n);
                    }}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Produto" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__">—</SelectItem>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    className="w-24"
                    type="number"
                    step="0.0001"
                    min="0"
                    placeholder="Qtd"
                    value={row.quantity}
                    onChange={(e) => {
                      const n = [...ings];
                      n[i] = { ...n[i]!, quantity: e.target.value };
                      setIngs(n);
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setIngs((p) => p.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setIngs((p) => [...p, { product_id: "", quantity: "1" }])
                }
              >
                <Plus className="mr-1 h-4 w-4" />
                Ingrediente
              </Button>
            </div>
          </div>
          <SheetFooter className="gap-2 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setSheetOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={saving}
              onClick={() => void saveRecipe()}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Salvar"
              )}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
