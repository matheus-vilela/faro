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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SaleFamilyLinkSheet } from "@/components/products/SaleFamilyLinkSheet";
import {
  listSaleFamilyForProduct,
  promoteProductToSaleFamily,
  unlinkSaleFamilyVariant,
  type SaleFamilyInfo,
} from "@/lib/productSaleFamily";
import { cn } from "@/lib/utils";
import { Loader2, Plus, Unlink } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

export function PossibleSaleFamilyTag({
  className,
}: {
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "border-amber-600/40 bg-amber-500/10 font-normal text-amber-950 dark:text-amber-100",
        className,
      )}
    >
      Possível agrupamento
    </Badge>
  );
}

export function ProductSaleFamilySection({
  companyId,
  productId,
  productName,
  stockControlType,
  className,
  onChanged,
}: {
  companyId: string;
  productId: string;
  productName?: string;
  stockControlType?: string | null;
  className?: string;
  onChanged?: () => void;
}) {
  const [info, setInfo] = useState<SaleFamilyInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmPromote, setConfirmPromote] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkAsVariant, setLinkAsVariant] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setInfo(await listSaleFamilyForProduct(companyId, productId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao ler o agrupamento.");
      setInfo(null);
    } finally {
      setLoading(false);
    }
  }, [companyId, productId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading || !info) return null;
  if (stockControlType === "RECIPE_CONTROLLED" && info.kind === "none") {
    return null;
  }

  const unlink = async (variantId: string) => {
    setBusy(true);
    try {
      await unlinkSaleFamilyVariant(companyId, variantId);
      toast.success("Variante desvinculada.");
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível desvincular.");
    } finally {
      setBusy(false);
    }
  };

  const promote = async () => {
    setBusy(true);
    try {
      await promoteProductToSaleFamily(productId);
      toast.success("Este item agora é agrupamento. A venda não baixa estoque.");
      setConfirmPromote(false);
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível promover.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn("space-y-3", className)}>
      <div>
        <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
          Agrupamento
        </p>
        {info.kind === "family" ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Item de cardápio. A venda não baixa estoque. As variantes saem pelo
            relatório de estoque do dia — só o sabor que o cliente pediu.
          </p>
        ) : info.kind === "variant" ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Continua sendo produto e faz parte do agrupamento{" "}
            <span className="text-foreground font-medium">
              {info.family?.name}
            </span>
            {info.family?.qty_per_sale != null
              ? ` (${info.family.qty_per_sale} por 1).`
              : "."}
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            Use quando o PDV vende um nome de cardápio (ex.: Bolinhos) e o
            estoque baixa o sabor do dia. Não é ficha técnica.
          </p>
        )}
      </div>

      {info.kind === "family" && info.members.length > 0 ? (
        <ul className="space-y-2">
          {info.members.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <div>
                <p className="font-medium">{m.name}</p>
                <p className="text-muted-foreground font-mono text-xs">
                  {m.sku || "sem SKU"} · {m.qty_per_sale} por 1
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void unlink(m.variant_product_id)}
              >
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Unlink className="size-3.5" />
                )}
                Desvincular
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {info.kind === "family" ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setLinkAsVariant(false);
            setLinkOpen(true);
          }}
        >
          <Plus className="size-3.5" />
          Vincular variante
        </Button>
      ) : null}

      {info.kind === "variant" ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void unlink(productId)}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Remover do agrupamento
        </Button>
      ) : null}

      {info.kind === "none" ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => setConfirmPromote(true)}
          >
            Tornar agrupamento
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setLinkAsVariant(true);
              setLinkOpen(true);
            }}
          >
            Vincular a um agrupamento
          </Button>
        </div>
      ) : null}

      <AlertDialog open={confirmPromote} onOpenChange={setConfirmPromote}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tornar agrupamento?</AlertDialogTitle>
            <AlertDialogDescription>
              {productName ? `«${productName}»` : "Este produto"} deixa de ser
              item de estoque. As próximas vendas geram receita e{" "}
              <strong>não baixam</strong> este SKU nem as variantes. A baixa
              passa a vir do relatório de estoque do dia, só nas variantes
              ligadas. Isso não é ficha técnica.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void promote();
              }}
            >
              {busy ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : null}
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SaleFamilyLinkSheet
        open={linkOpen}
        onOpenChange={setLinkOpen}
        companyId={companyId}
        familyProductId={info.kind === "family" ? productId : null}
        variantProductId={linkAsVariant ? productId : null}
        variantName={linkAsVariant ? productName : null}
        onLinked={() => {
          void load();
          onChanged?.();
        }}
      />
    </div>
  );
}
