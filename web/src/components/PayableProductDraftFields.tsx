import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  productSearchOption,
  SearchSelect,
} from "@/components/ui/search-select";
import { Switch } from "@/components/ui/switch";
import {
  emptyPayableProductLine,
  type PayableProductDraftLine,
} from "@/lib/boletoCategoryRateio";
import { cn } from "@/lib/utils";
import type { Product } from "@/types/product";
import { Plus, Trash2 } from "lucide-react";
import { useMemo } from "react";

export function PayableProductDraftFields({
  enabled,
  onEnabledChange,
  lines,
  onLinesChange,
  products,
  generateRecebimento,
  onGenerateRecebimentoChange,
  hasLinkedProduct,
  disabled,
}: {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  lines: PayableProductDraftLine[];
  onLinesChange: (lines: PayableProductDraftLine[]) => void;
  products: Product[];
  generateRecebimento: boolean;
  onGenerateRecebimentoChange: (next: boolean) => void;
  hasLinkedProduct: boolean;
  disabled?: boolean;
}) {
  const productSelectOptions = useMemo(
    () =>
      products.filter((p) => p.is_active !== false).map(productSearchOption),
    [products],
  );

  const updateLine = (key: string, patch: Partial<PayableProductDraftLine>) => {
    onLinesChange(
      lines.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  };

  return (
    <div className="space-y-3">
      <div
        className={cn(
          "flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5",
          enabled
            ? "border-primary/40 bg-primary/5"
            : "border-border bg-muted/50",
        )}
      >
        <div>
          <Label htmlFor="boleto-products-switch" className="pb-0 text-sm">
            Adicionar produtos
          </Label>
          <p className="mt-1 text-xs text-muted-foreground">
            Vincule itens de estoque a esta conta. O recebimento continua
            opcional.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs font-medium tabular-nums text-muted-foreground">
            {enabled ? "Sim" : "Não"}
          </span>
          <Switch
            id="boleto-products-switch"
            checked={enabled}
            disabled={disabled}
            onCheckedChange={onEnabledChange}
            className={cn(
              "border-2",
              "data-[state=unchecked]:border-muted-foreground data-[state=unchecked]:bg-muted",
              "data-[state=checked]:border-primary data-[state=checked]:bg-primary",
              "[&_span]:bg-white dark:[&_span]:bg-zinc-100",
              "data-[state=checked]:[&_span]:bg-primary-foreground",
            )}
          />
        </div>
      </div>

      {enabled ? (
        <div className="space-y-3 rounded-lg border p-3">
          {lines.map((line, index) => (
            <div
              key={line.key}
              className="grid gap-2 sm:grid-cols-[1fr_5.5rem_7rem_auto] sm:items-end"
            >
              <div className="min-w-0">
                {index === 0 ? <Label>Produto</Label> : null}
                <SearchSelect
                  value={line.productId}
                  onValueChange={(id) => {
                    const product = products.find((p) => p.id === id);
                    updateLine(line.key, {
                      productId: id,
                      productName: product?.name ?? "",
                      unitValue:
                        product?.last_unit_value != null &&
                        product.last_unit_value > 0
                          ? product.last_unit_value
                          : line.unitValue,
                    });
                  }}
                  options={productSelectOptions}
                  placeholder="Buscar produto…"
                  searchPlaceholder="Buscar produto…"
                  emptyMessage="Nenhum produto encontrado."
                  disabled={disabled}
                />
              </div>
              <div>
                {index === 0 ? <Label>Qtd</Label> : null}
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={line.quantity || ""}
                  disabled={disabled}
                  onChange={(e) =>
                    updateLine(line.key, {
                      quantity: parseFloat(e.target.value) || 0,
                    })
                  }
                />
              </div>
              <div>
                {index === 0 ? <Label>Valor un.</Label> : null}
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={Number.isFinite(line.unitValue) ? String(line.unitValue) : ""}
                  disabled={disabled}
                  onChange={(e) =>
                    updateLine(line.key, {
                      unitValue: parseFloat(e.target.value) || 0,
                    })
                  }
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0"
                disabled={disabled || lines.length <= 1}
                onClick={() =>
                  onLinesChange(lines.filter((item) => item.key !== line.key))
                }
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() =>
              onLinesChange([...lines, emptyPayableProductLine()])
            }
          >
            <Plus className="mr-1 h-4 w-4" />
            Adicionar produto
          </Button>
          {hasLinkedProduct ? (
            <div className="flex items-start justify-between gap-3 rounded-md border border-dashed px-3 py-2.5">
              <div className="min-w-0">
                <Label htmlFor="boleto-recebimento-switch" className="pb-0 text-sm">
                  Gerar recebimento
                </Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Cria a conferência em Notas e recebimento. Estoque só entra
                  quando a mercadoria for confirmada.
                </p>
              </div>
              <Switch
                id="boleto-recebimento-switch"
                checked={generateRecebimento}
                disabled={disabled}
                onCheckedChange={onGenerateRecebimentoChange}
                className={cn(
                  "mt-0.5 shrink-0 border-2",
                  "data-[state=unchecked]:border-muted-foreground data-[state=unchecked]:bg-muted",
                  "data-[state=checked]:border-primary data-[state=checked]:bg-primary",
                  "[&_span]:bg-white dark:[&_span]:bg-zinc-100",
                  "data-[state=checked]:[&_span]:bg-primary-foreground",
                )}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
