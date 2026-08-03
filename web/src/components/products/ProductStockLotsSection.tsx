import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PRODUCT_SHEET_INPUT,
  PRODUCT_SHEET_SECTION,
} from "@/components/products/productSheetStyles";
import {
  formatLotExpiryDate,
  LOT_EXPIRY_STATUS_LABEL,
  lotExpiryStatus,
  parseProductStockLots,
  summarizeLotAlerts,
  type ProductStockLotEntry,
} from "@/lib/productStockLots";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { AlertTriangle, CalendarClock, Loader2, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type Props = {
  productId: string;
  unit: string;
  currentStock?: number;
  className?: string;
  refreshKey?: number;
  readOnly?: boolean;
  /** Lotes controlados pelo pai (salvos junto com o produto). */
  lots?: ProductStockLotEntry[];
  onLotsChange?: (lots: ProductStockLotEntry[]) => void;
};

export function ProductStockLotsSection({
  productId,
  unit,
  currentStock,
  className,
  refreshKey = 0,
  readOnly = false,
  lots: controlledLots,
  onLotsChange,
}: Props) {
  const [internalLots, setInternalLots] = useState<ProductStockLotEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lotQty, setLotQty] = useState("");
  const [lotExpiry, setLotExpiry] = useState("");

  const isControlled = controlledLots != null && onLotsChange != null;
  const lots = isControlled ? controlledLots : internalLots;

  const setLots = useCallback(
    (next: ProductStockLotEntry[]) => {
      if (isControlled) {
        onLotsChange!(next);
      } else {
        setInternalLots(next);
      }
    },
    [isControlled, onLotsChange],
  );

  const load = useCallback(async () => {
    if (isControlled || !productId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("products")
      .select("stock_lots")
      .eq("id", productId)
      .maybeSingle();

    setLoading(false);
    if (error) {
      console.error(error);
      setInternalLots([]);
      if (
        error.message.includes("stock_lots") ||
        error.code === "42703"
      ) {
        toast.error(
          "Campo de lotes indisponível. Execute a migration 20260524150000 no Supabase.",
        );
      }
      return;
    }
    setInternalLots(parseProductStockLots(data?.stock_lots));
  }, [productId, isControlled]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load, refreshKey]);

  const persistLots = async (next: ProductStockLotEntry[]) => {
    if (!productId) return;
    setSaving(true);
    const { error } = await supabase
      .from("products")
      .update({ stock_lots: next })
      .eq("id", productId);
    setSaving(false);
    if (error) {
      console.error(error);
      toast.error("Não foi possível salvar os lotes.");
      return false;
    }
    setLots(next);
    return true;
  };

  const registerLot = async () => {
    const qty = parseFloat(lotQty.replace(",", "."));
    if (Number.isNaN(qty) || qty <= 0) {
      toast.error("Informe uma quantidade válida para o lote.");
      return;
    }
    if (!lotExpiry.trim()) {
      toast.error("Informe a data de validade do lote.");
      return;
    }

    const entry: ProductStockLotEntry = {
      id: crypto.randomUUID(),
      quantity: qty,
      expiry_date: lotExpiry.trim().slice(0, 10),
      created_at: new Date().toISOString(),
    };
    const next = [...lots, entry].sort((a, b) => {
      const da = a.expiry_date.localeCompare(b.expiry_date);
      if (da !== 0) return da;
      return (b.created_at ?? "").localeCompare(a.created_at ?? "");
    });

    if (isControlled) {
      setLots(next);
      setLotQty("");
      setLotExpiry("");
      toast.success("Lote adicionado. Salve o produto para persistir.");
      return;
    }

    const ok = await persistLots(next);
    if (!ok) return;
    toast.success("Lote registrado.");
    setLotQty("");
    setLotExpiry("");
  };

  const removeLot = async (lotId: string) => {
    const next = lots.filter((l) => l.id !== lotId);
    if (isControlled) {
      setLots(next);
      toast.success("Lote removido. Salve o produto para persistir.");
      return;
    }
    const ok = await persistLots(next);
    if (ok) toast.success("Lote removido.");
  };

  const alerts = useMemo(() => summarizeLotAlerts(lots), [lots]);

  if (loading && !isControlled) {
    return null;
  }

  if (lots.length === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        PRODUCT_SHEET_SECTION,
        "border-amber-500/40 bg-gradient-to-br from-amber-500/[0.07] via-card to-card shadow-md ring-1 ring-amber-500/25",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-amber-900/90 dark:text-amber-100/90">
            Lotes com validade
          </p>
          <p className="mt-1 max-w-xl text-xs text-muted-foreground">
            Controle por lote no cadastro do produto ou em entradas manuais com
            data de validade. O saldo em estoque pode ser maior que a soma dos
            lotes.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {alerts.hasExpired ? (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              Produtos vencidos
            </Badge>
          ) : null}
          {alerts.hasNearExpiry ? (
            <Badge
              variant="outline"
              className="gap-1 border-amber-500/50 bg-amber-500/10 text-amber-950 dark:text-amber-50"
            >
              <CalendarClock className="h-3 w-3" />
              Próximo ao vencimento (5 dias)
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border/70 bg-background/80 px-3 py-2">
          <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
            Total nos lotes
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {alerts.totalInLots.toLocaleString("pt-BR")}{" "}
            <span className="text-sm font-medium text-muted-foreground">
              {unit}
            </span>
          </p>
        </div>
        {currentStock != null ? (
          <div className="rounded-xl border border-border/70 bg-background/80 px-3 py-2">
            <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
              Em estoque
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {Number(currentStock).toLocaleString("pt-BR")}{" "}
              <span className="text-sm font-medium text-muted-foreground">
                {unit}
              </span>
            </p>
          </div>
        ) : null}
        <div className="rounded-xl border border-border/70 bg-background/80 px-3 py-2">
          <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
            Lotes cadastrados
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{lots.length}</p>
        </div>
      </div>

      <ul className="mt-4 space-y-2">
        {lots.map((lot) => {
          const status = lotExpiryStatus(lot.expiry_date);
          return (
            <li
              key={lot.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/80 bg-background/90 px-3 py-2.5 text-sm"
            >
              <div>
                <p className="font-medium tabular-nums">
                  {Number(lot.quantity).toLocaleString("pt-BR")} {unit}
                </p>
                <p className="text-xs text-muted-foreground">
                  Validade: {formatLotExpiryDate(lot.expiry_date)}
                  {lot.stock_movement_id ? " · via movimentação" : null}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant={
                    status === "expired"
                      ? "destructive"
                      : status === "near"
                        ? "outline"
                        : "secondary"
                  }
                  className={cn(
                    status === "near" &&
                      "border-amber-500/50 bg-amber-500/10 text-amber-950 dark:text-amber-50",
                  )}
                >
                  {LOT_EXPIRY_STATUS_LABEL[status]}
                </Badge>
                {!readOnly ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    disabled={saving}
                    onClick={() => void removeLot(lot.id)}
                    aria-label="Remover lote"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {!readOnly ? (
        <div className="mt-5 rounded-xl border border-dashed border-amber-500/35 bg-background/60 p-4">
          <p className="mb-3 text-sm font-medium">Registrar lote</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="lot-qty">Quantidade</Label>
              <Input
                id="lot-qty"
                type="number"
                step="0.0001"
                min="0"
                value={lotQty}
                onChange={(e) => setLotQty(e.target.value)}
                className={PRODUCT_SHEET_INPUT}
                placeholder={`Ex.: 10 ${unit}`}
              />
            </div>
            <div>
              <Label htmlFor="lot-expiry">Data de validade</Label>
              <Input
                id="lot-expiry"
                type="date"
                value={lotExpiry}
                onChange={(e) => setLotExpiry(e.target.value)}
                className={PRODUCT_SHEET_INPUT}
              />
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            className="mt-3"
            disabled={saving}
            onClick={() => void registerLot()}
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Salvando…
              </>
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" />
                Registrar lote
              </>
            )}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
