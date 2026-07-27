import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  BCG_QUADRANT_LABELS,
  type BcgQuadrant,
  type CmvProductRow,
} from "@/lib/cmvMargensResumo";
import { formatBrl } from "@/lib/dre/formatBrl";
import { ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";

const QUADRANT_HINTS: Record<BcgQuadrant, string> = {
  estrela: "Vende bem e com boa margem — proteja o preço e a qualidade.",
  vaca: "Volume alto, margem abaixo da meta — revise preço ou custo.",
  aposta: "Boa margem, pouco volume — vale empurrar no cardápio.",
  abacaxi: "Pouco volume e margem fraca — revise preço, custo ou permanência.",
};

function formatPct(value: number | null, digits = 1): string {
  if (value == null) return "—";
  return `${value.toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

function formatMarkup(value: number | null): string {
  if (value == null) return "—";
  return `${value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}x`;
}

function formatDeltaPp(value: number | null): string {
  if (value == null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} pp`;
}

function ctaFor(product: CmvProductRow): {
  to: string;
  label: string;
} {
  if (product.productId) {
    return {
      to: `/app/produtos?highlight=${encodeURIComponent(product.productId)}`,
      label: "Abrir produto",
    };
  }
  if (product.recipeId) {
    return {
      to: "/app/produtos?estoque=receitas",
      label: "Abrir ficha",
    };
  }
  return { to: "/app/produtos", label: "Abrir produtos" };
}

export function CmvProductDetailSheet({
  product,
  open,
  onOpenChange,
  compare,
}: {
  product: CmvProductRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  compare: boolean;
}) {
  const cta = product ? ctaFor(product) : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col sm:max-w-md">
        {product ? (
          <>
            <SheetHeader>
              <div className="flex flex-wrap items-center gap-2">
                <SheetTitle className="pr-2">{product.label}</SheetTitle>
                <Badge variant="secondary">
                  {BCG_QUADRANT_LABELS[product.quadrant]}
                </Badge>
              </div>
              <SheetDescription>
                {QUADRANT_HINTS[product.quadrant]}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
              <Metric
                label="Volume"
                value={product.quantity.toLocaleString("pt-BR", {
                  maximumFractionDigits: 2,
                })}
              />
              <Metric label="Receita" value={formatBrl(product.revenue)} />
              <Metric label="CMV" value={formatBrl(product.cmv)} />
              <Metric
                label="Preço compra"
                value={formatBrl(product.costPrice)}
              />
              <Metric
                label="Preço venda"
                value={formatBrl(product.sellPrice)}
              />
              <Metric label="Markup" value={formatMarkup(product.markup)} />
              <Metric
                label="Margem"
                value={formatPct(product.marginPct, 1)}
              />
              {compare ? (
                <Metric
                  label="Δ vs ant."
                  value={formatDeltaPp(product.marginDeltaPp)}
                />
              ) : null}
            </div>

            <SheetFooter className="mt-auto border-t pt-4">
              {cta ? (
                <Button asChild className="w-full sm:w-auto">
                  <Link to={cta.to} onClick={() => onOpenChange(false)}>
                    {cta.label}
                    <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                  </Link>
                </Button>
              ) : null}
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 tabular-nums font-semibold text-foreground">
        {value}
      </p>
    </div>
  );
}
