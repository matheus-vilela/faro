import { CreateProductSheet } from "@/components/CreateProductSheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCompany } from "@/contexts/CompanyContext";
import { supabase } from "@/lib/supabase";
import type { Product } from "@/types/product";
import { AlertTriangle, Package, Plus } from "lucide-react";
import { useEffect, useState } from "react";

export function Produtos() {
  const { currentCompany } = useCompany();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [productSheetOpen, setProductSheetOpen] = useState(false);
  const [stockProduct, setStockProduct] = useState<Product | null>(null);
  const [stockQuantity, setStockQuantity] = useState("");
  const [stockSaving, setStockSaving] = useState(false);

  const fetchProducts = async () => {
    if (!currentCompany?.id) return;
    setLoading(true);
    const { data } = await supabase
      .from("products")
      .select("*")
      .eq("company_id", currentCompany.id)
      .order("name");
    setProducts((data as Product[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    queueMicrotask(() => void fetchProducts());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCompany?.id]);

  const filtered = products.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.sku ?? "").toLowerCase().includes(search.toLowerCase()),
  );

  const lowStock = filtered.filter(
    (p) => p.current_quantity <= p.min_quantity && p.min_quantity > 0,
  );

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(v);

  const openStockSheet = (p: Product) => {
    setStockProduct(p);
    setStockQuantity(String(p.current_quantity));
  };

  const handleStockSave = async () => {
    if (!stockProduct) return;
    const newQty = parseFloat(stockQuantity);
    if (Number.isNaN(newQty) || newQty < 0) return;
    const currentQty = Number(stockProduct.current_quantity);
    const delta = newQty - currentQty;
    if (delta === 0) {
      setStockProduct(null);
      return;
    }
    setStockSaving(true);
    const { error } = await supabase.rpc("adjust_product_stock", {
      p_product_id: stockProduct.id,
      p_delta: delta,
      p_type: delta > 0 ? "in" : "out",
      p_reference_type: "adjustment",
      p_reference_id: null,
    });
    setStockSaving(false);
    if (error) {
      console.error(error);
      return;
    }
    setStockProduct(null);
    fetchProducts();
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Produtos</h1>
        <p className="text-muted-foreground">
          Cadastre produtos e controle o estoque
        </p>
      </div>

      {currentCompany?.id && (
        <CreateProductSheet
          open={productSheetOpen}
          onOpenChange={setProductSheetOpen}
          companyId={currentCompany.id}
          onSuccess={() => fetchProducts()}
        />
      )}

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Produtos cadastrados
            </CardTitle>
            <CardDescription>
              Vincule itens das despesas aos produtos para atualizar o estoque
            </CardDescription>
          </div>
          <Button onClick={() => setProductSheetOpen(true)} size="sm">
            <Plus className="h-4 w-4 mr-1" />
            Novo produto
          </Button>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <Input
              placeholder="Buscar por nome ou SKU..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
          </div>
          {loading ? (
            <p className="text-muted-foreground">Carregando...</p>
          ) : filtered.length === 0 ? (
            <p className="text-muted-foreground">Nenhum produto cadastrado</p>
          ) : (
            <div className="space-y-2">
              {filtered.map((p) => {
                const isLowStock =
                  p.min_quantity > 0 && p.current_quantity <= p.min_quantity;
                return (
                  <div
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openStockSheet(p)}
                    onKeyDown={(e) => e.key === "Enter" && openStockSheet(p)}
                    className="flex items-center justify-between gap-4 rounded-lg border p-4 cursor-pointer hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex-1 flex justify-between min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="flex flex-col items-start gap-2">
                          <span className="font-medium">{p.name}</span>
                          {p.sku && (
                            <span className="text-xs text-muted-foreground rounded bg-muted px-2 py-0.5">
                              {p.sku}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <p className="text-sm text-muted-foreground mt-1">
                          Estoque:{" "}
                          {Number(p.current_quantity).toLocaleString("pt-BR")}{" "}
                          {p.unit}
                          {p.min_quantity > 0 && (
                            <span className="ml-2">
                              • Mín:{" "}
                              {Number(p.min_quantity).toLocaleString("pt-BR")}{" "}
                              {p.unit}
                            </span>
                          )}
                          {p.last_unit_value != null && p.last_unit_value > 0 && (
                            <span className="ml-2">
                              • Último: {formatCurrency(Number(p.last_unit_value))}/{p.unit}
                            </span>
                          )}
                        </p>
                        {isLowStock && (
                          <Badge variant="destructive" className="gap-1">
                            <AlertTriangle className="h-3 w-3" />
                            Estoque baixo
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet
        open={!!stockProduct}
        onOpenChange={(o) => !o && setStockProduct(null)}
      >
        <SheetContent>
          {stockProduct && (
            <>
              <SheetHeader>
                <SheetTitle>Atualizar estoque</SheetTitle>
                <SheetDescription>
                  {stockProduct.name}
                  {stockProduct.sku && ` (${stockProduct.sku})`}
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-4 py-6">
                <div>
                  <Label>Quantidade em estoque</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={stockQuantity}
                    onChange={(e) => setStockQuantity(e.target.value)}
                    className="mt-2"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Unidade: {stockProduct.unit} • Mínimo:{" "}
                    {Number(stockProduct.min_quantity).toLocaleString("pt-BR")}
                    {stockProduct.last_unit_value != null && stockProduct.last_unit_value > 0 && (
                      <> • Último pago: {formatCurrency(Number(stockProduct.last_unit_value))}/{stockProduct.unit}</>
                    )}
                  </p>
                </div>
              </div>
              <SheetFooter>
                <Button
                  variant="outline"
                  onClick={() => setStockProduct(null)}
                  disabled={stockSaving}
                >
                  Cancelar
                </Button>
                <Button onClick={handleStockSave} disabled={stockSaving}>
                  {stockSaving ? "Salvando..." : "Salvar"}
                </Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>

      {lowStock.length > 0 && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              {lowStock.length} produto(s) com estoque abaixo do mínimo
            </CardTitle>
            <CardDescription>
              Verifique o recebimento de notas ou ajuste as quantidades mínimas
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
