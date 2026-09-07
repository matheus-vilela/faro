import { ProductMergeMovementPair } from "@/components/estoque/ProductMergeMovementPair";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  REVENUE_ENTRY_MODE_LABEL,
  movementLineTotalCost,
  productStockRoleHint,
  productStockRoleLabel,
  recipeKindLabel,
  type StockMovementDetailContext,
} from "@/lib/stockMovementDetailContext";
import { movementClassificationDisplayLabel } from "@/lib/stockMovementClassification";
import { stockMovementSignedQuantity } from "@/lib/stockMovementEdit";
import {
  formatInvoiceLabel,
  type StockMovementInvoiceContext,
} from "@/lib/stockMovementInvoiceContext";
import { stockMovementMergePairDisplay } from "@/lib/stockMovementMergeDisplay";
import { maskCpfCnpj } from "@/lib/masks";
import { productHighlightPath } from "@/lib/productStockPaths";
import { INTERMEDIATE_BADGE_CLASS } from "@/lib/productIntermediate";
import { cn } from "@/lib/utils";
import type { StockMovementEditRow } from "@/lib/stockMovementEdit";
import { ChefHat, CircleDollarSign, Factory, FileText } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

const SECTION =
  "rounded-2xl border border-border bg-card p-4 shadow-sm";

function formatYmdBr(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return ymd;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(date.getTime())) return ymd;
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function DetailField({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}

function InvoiceFields({
  invoice,
}: {
  invoice: StockMovementInvoiceContext;
}) {
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      <DetailField label="Documento">
        {formatInvoiceLabel(invoice.invoiceNumber, invoice.invoiceSeries) ??
          "Cadastro pela NF-e"}
      </DetailField>
      {invoice.supplierName ? (
        <DetailField label="Fornecedor">
          {invoice.supplierName}
          {invoice.supplierDocument ? (
            <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
              {maskCpfCnpj(invoice.supplierDocument)}
            </span>
          ) : null}
        </DetailField>
      ) : null}
      {invoice.originalItemName ? (
        <DetailField label="Item original na nota" className="sm:col-span-2">
          <span className="leading-snug">{invoice.originalItemName}</span>
        </DetailField>
      ) : null}
      {invoice.invoiceQuantity != null ? (
        <DetailField label="Quantidade na nota">
          <span className="tabular-nums">
            {invoice.invoiceQuantity.toLocaleString("pt-BR")}
            {invoice.invoiceUnit ? ` ${invoice.invoiceUnit}` : ""}
          </span>
        </DetailField>
      ) : null}
    </dl>
  );
}

export function StockMovementDetailSummary({
  movement,
  context,
  loading,
  formatCurrency,
  onOpenExpense,
  onOpenRevenue,
  productDisplayName,
}: {
  movement: StockMovementEditRow;
  context: StockMovementDetailContext | null;
  loading: boolean;
  formatCurrency: (v: number) => string;
  onOpenExpense: (expenseId: string) => void;
  onOpenRevenue: (revenueId: string) => void;
  productDisplayName: string;
}) {
  const product = context?.product;
  const recipe = context?.recipe;
  const revenue = context?.revenue;
  const invoice = context?.invoice;
  const role = product?.role ?? "direct";
  const signed = stockMovementSignedQuantity(movement.type, movement.quantity);
  const unit =
    movement.metadata_json?.quantity_unit?.trim() ||
    movement.products?.unit ||
    product?.unit ||
    "un";
  const total = movementLineTotalCost(movement.quantity, movement.unit_cost);
  const mergePair = stockMovementMergePairDisplay(movement, productDisplayName);
  const showRoleChip = role !== "direct";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {showRoleChip ? (
          <Badge
            variant="outline"
            className={cn(
              "font-normal",
              role === "intermediate" && INTERMEDIATE_BADGE_CLASS,
              role === "recipe_sale" &&
                "border-amber-500/35 bg-amber-500/10 text-amber-950 dark:text-amber-100",
            )}
          >
            {productStockRoleLabel(role)}
          </Badge>
        ) : null}
        {recipe &&
        !(role === "recipe_sale" && recipe.kind === "sale") &&
        !(role === "intermediate" && recipe.kind === "production") ? (
          <Badge
            variant="outline"
            className={cn(
              "gap-1 font-normal",
              recipe.kind === "production"
                ? INTERMEDIATE_BADGE_CLASS
                : "border-amber-500/35 bg-amber-500/10 text-amber-950 dark:text-amber-100",
            )}
          >
            {recipe.kind === "production" ? (
              <Factory className="h-3 w-3" />
            ) : (
              <ChefHat className="h-3 w-3" />
            )}
            {recipeKindLabel(recipe.kind)}
          </Badge>
        ) : null}
      </div>

      <section className={SECTION}>
        <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
          Desta linha
        </p>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <DetailField label="Produto" className="sm:col-span-2">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span>{productDisplayName}</span>
              {product?.sku ? (
                <span className="text-xs font-normal text-muted-foreground">
                  {product.sku}
                </span>
              ) : null}
            </div>
            {product ? (
              <p className="mt-1 text-xs font-normal text-muted-foreground">
                {productStockRoleHint(role)}
              </p>
            ) : null}
          </DetailField>
          <DetailField label="Quantidade">
            <span
              className={cn(
                "tabular-nums",
                signed > 0 && "text-emerald-700 dark:text-emerald-300",
                signed < 0 && "text-rose-700 dark:text-rose-300",
              )}
            >
              {signed > 0 ? "+" : ""}
              {signed.toLocaleString("pt-BR")} {unit}
            </span>
          </DetailField>
          <DetailField label="Classificação">
            <span className="font-normal text-muted-foreground">
              {movementClassificationDisplayLabel(movement)}
            </span>
          </DetailField>
          <DetailField label="Custo unitário">
            <span className="tabular-nums">
              {movement.unit_cost != null
                ? formatCurrency(Number(movement.unit_cost))
                : "—"}
            </span>
          </DetailField>
          <DetailField label="Custo desta linha">
            <span className="tabular-nums">
              {total != null ? formatCurrency(total) : "—"}
            </span>
          </DetailField>
          {product?.average_cost != null ? (
            <DetailField label="Custo médio atual do produto">
              <span className="tabular-nums">
                {formatCurrency(product.average_cost)}
              </span>
            </DetailField>
          ) : null}
        </dl>
        {product ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-3 h-8 px-0 text-muted-foreground"
            asChild
          >
            <Link to={productHighlightPath(product.id)}>Abrir produto</Link>
          </Button>
        ) : null}
      </section>

      {mergePair ? (
        <section className={SECTION}>
          <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
            Unificação
          </p>
          <div className="mt-3">
            <ProductMergeMovementPair {...mergePair} />
          </div>
        </section>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">
          Carregando origem da movimentação…
        </p>
      ) : null}

      {revenue ? (
        <section className={SECTION}>
          <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
            Venda que originou
          </p>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <DetailField label="Dia da venda">
              {formatYmdBr(revenue.entry_date)}
            </DetailField>
            <DetailField label="Lançamento">{revenue.title}</DetailField>
            {revenue.entry_mode ? (
              <DetailField label="Tipo">
                {REVENUE_ENTRY_MODE_LABEL[revenue.entry_mode] ??
                  revenue.entry_mode}
              </DetailField>
            ) : null}
            {revenue.quantity != null ? (
              <DetailField label="Quantidade vendida">
                <span className="tabular-nums">
                  {revenue.quantity.toLocaleString("pt-BR")}
                  {revenue.sale_unit_code
                    ? ` ${revenue.sale_unit_code}`
                    : ""}
                </span>
              </DetailField>
            ) : null}
            <DetailField label="Faturamento bruto">
              <span className="tabular-nums">
                {formatCurrency(revenue.gross_amount)}
              </span>
            </DetailField>
            <DetailField label="Líquido">
              <span className="tabular-nums">
                {formatCurrency(revenue.net_amount)}
              </span>
            </DetailField>
            {revenue.cmv_amount != null ? (
              <DetailField label="CMV da venda">
                <span className="tabular-nums">
                  {formatCurrency(revenue.cmv_amount)}
                </span>
              </DetailField>
            ) : null}
          </dl>
          <Button
            type="button"
            className="mt-4 w-full gap-2 sm:w-auto"
            onClick={() => onOpenRevenue(revenue.id)}
          >
            <CircleDollarSign className="h-4 w-4" />
            Abrir venda
          </Button>
        </section>
      ) : null}

      {invoice ? (
        <section className={SECTION}>
          <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
            Compra / nota fiscal
          </p>
          <div className="mt-3">
            <InvoiceFields invoice={invoice} />
          </div>
          {invoice.expenseId ? (
            <Button
              type="button"
              className="mt-4 w-full gap-2 sm:w-auto"
              onClick={() => onOpenExpense(invoice.expenseId!)}
            >
              <FileText className="h-4 w-4" />
              Visualizar nota
            </Button>
          ) : null}
        </section>
      ) : null}

      {recipe ? (
        <section className={SECTION}>
          <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
            {recipeKindLabel(recipe.kind)}
          </p>
          <p className="mt-2 text-sm font-medium">{recipe.name}</p>
          {recipe.output_product_name ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {recipe.kind === "production"
                ? "Produz "
                : "Baixa insumos do prato "}
              <span className="font-medium text-foreground">
                {recipe.output_product_name}
              </span>
            </p>
          ) : null}
          <p className="mt-2 text-sm text-muted-foreground">
            {recipe.ingredientOut
              ? recipe.kind === "production"
                ? "Esta linha é a baixa do insumo na produção."
                : "Esta linha é a baixa do insumo na venda da ficha."
              : recipe.kind === "production"
                ? "Esta linha é a entrada do intermediário produzido."
                : "Movimentação ligada a esta ficha técnica."}
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-4 w-full gap-2 sm:w-auto"
            asChild
          >
            <Link to={recipe.href}>Abrir ficha</Link>
          </Button>
        </section>
      ) : null}
    </div>
  );
}
