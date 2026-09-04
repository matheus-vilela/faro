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
import { SaleFamilyLinkSheet } from "@/components/products/SaleFamilyLinkSheet";
import {
  demoteProductFromSaleFamily,
  listSaleFamilyForProduct,
  promoteProductToSaleFamily,
  setProductNotSaleGrouping,
  unlinkSaleFamilyVariant,
  type SaleFamilyInfo,
} from "@/lib/productSaleFamily";
import { cn } from "@/lib/utils";
import {
  Ban,
  ChefHat,
  Layers,
  Link2,
  Loader2,
  Merge,
  Plus,
  Unlink,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

function SetupActionButton({
  icon,
  label,
  hint,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled}
      onClick={onClick}
      className="h-auto items-start justify-start gap-3 whitespace-normal px-3 py-3 text-left"
    >
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
          {hint}
        </span>
      </span>
    </Button>
  );
}

export function ProductSetupCard({
  companyId,
  productId,
  productName,
  stockControlType,
  notSaleGrouping,
  hasTechnicalSheet,
  className,
  onOpenTechnicalSheet,
  onOpenMerge,
  onChanged,
}: {
  companyId: string;
  productId: string;
  productName?: string;
  stockControlType?: string | null;
  notSaleGrouping?: boolean;
  hasTechnicalSheet?: boolean;
  className?: string;
  onOpenTechnicalSheet: () => void;
  onOpenMerge: () => void;
  onChanged?: () => void;
}) {
  const [info, setInfo] = useState<SaleFamilyInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmPromote, setConfirmPromote] = useState(false);
  const [confirmDemote, setConfirmDemote] = useState(false);
  const [confirmNotGrouping, setConfirmNotGrouping] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkAsVariant, setLinkAsVariant] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setInfo(await listSaleFamilyForProduct(companyId, productId));
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Falha ao ler o agrupamento.",
      );
      setInfo(null);
    } finally {
      setLoading(false);
    }
  }, [companyId, productId]);

  useEffect(() => {
    void load();
  }, [load]);

  const kind = info?.kind ?? "none";
  const isRecipe = stockControlType === "RECIPE_CONTROLLED";
  const isFamily = kind === "family" || stockControlType === "SALE_FAMILY";
  const dismissed = Boolean(notSaleGrouping) && kind === "none" && !isRecipe;

  const unlink = async (variantId: string) => {
    setBusy(true);
    try {
      await unlinkSaleFamilyVariant(companyId, variantId);
      toast.success("Variante desvinculada.");
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Não foi possível desvincular.",
      );
    } finally {
      setBusy(false);
    }
  };

  const promote = async () => {
    setBusy(true);
    try {
      await promoteProductToSaleFamily(productId);
      toast.success(
        "Este item agora é agrupamento. A venda não baixa estoque.",
      );
      setConfirmPromote(false);
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Não foi possível promover.",
      );
    } finally {
      setBusy(false);
    }
  };

  const demote = async () => {
    setBusy(true);
    try {
      await demoteProductFromSaleFamily(productId);
      toast.success("Deixou de ser agrupamento.");
      setConfirmDemote(false);
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Não foi possível desfazer o agrupamento.",
      );
    } finally {
      setBusy(false);
    }
  };

  const markNotGrouping = async (value: boolean) => {
    setBusy(true);
    try {
      await setProductNotSaleGrouping(productId, value);
      toast.success(
        value
          ? "Marcado como item comum — não é agrupamento."
          : "Pode ser agrupamento de novo.",
      );
      setConfirmNotGrouping(false);
      onChanged?.();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Não foi possível salvar.",
      );
    } finally {
      setBusy(false);
    }
  };

  const description = isRecipe
    ? "Este item é ficha técnica. A venda baixa os insumos fixos."
    : isFamily
      ? "Item de cardápio. A venda não baixa estoque. As variantes saem pelo relatório de estoque do dia."
      : kind === "variant"
        ? `Faz parte do agrupamento ${info?.family?.name ?? ""}. Não é ficha técnica.`
        : dismissed
          ? "Marcado como item comum. Não aparece como possível agrupamento."
          : "Configure se este cadastro é agrupamento de cardápio, ficha técnica, ou o mesmo item que outro produto.";

  return (
    <div className={cn("space-y-4", className)}>
      <div>
        <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
          Configuração
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando configuração…</p>
      ) : null}

      {isFamily && info && info.members.length > 0 ? (
        <ul className="space-y-2">
          {info.members.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <div>
                <p className="font-medium">{m.name}</p>
                <p className="font-mono text-xs text-muted-foreground">
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

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {isFamily ? (
          <>
            <SetupActionButton
              icon={<Plus className="size-4" />}
              label="Vincular variante"
              hint="Liga um item de estoque a este agrupamento"
              disabled={busy}
              onClick={() => {
                setLinkAsVariant(false);
                setLinkOpen(true);
              }}
            />
            <SetupActionButton
              icon={<Ban className="size-4" />}
              label="Deixar de ser agrupamento"
              hint="Volta a ser item comum. Variantes são desvinculadas."
              disabled={busy}
              onClick={() => setConfirmDemote(true)}
            />
          </>
        ) : null}

        {kind === "variant" ? (
          <SetupActionButton
            icon={<Unlink className="size-4" />}
            label="Remover do agrupamento"
            hint={
              info?.family?.name
                ? `Sai de ${info.family.name}`
                : "Desvincula deste agrupamento"
            }
            disabled={busy}
            onClick={() => void unlink(productId)}
          />
        ) : null}

        {kind === "none" && !isRecipe ? (
          <>
            <SetupActionButton
              icon={<Layers className="size-4" />}
              label="Tornar agrupamento"
              hint="Venda de cardápio sem baixa neste SKU"
              disabled={busy}
              onClick={() => setConfirmPromote(true)}
            />
            <SetupActionButton
              icon={<Link2 className="size-4" />}
              label="Vincular a um agrupamento"
              hint="Este item passa a ser variante de outro"
              disabled={busy}
              onClick={() => {
                setLinkAsVariant(true);
                setLinkOpen(true);
              }}
            />
          </>
        ) : null}

        <SetupActionButton
          icon={<ChefHat className="size-4" />}
          label={hasTechnicalSheet ? "Editar ficha técnica" : "É ficha técnica"}
          hint="Composição fixa de insumos na venda"
          disabled={busy}
          onClick={onOpenTechnicalSheet}
        />
        <SetupActionButton
          icon={<Merge className="size-4" />}
          label="Unificar com outro"
          hint="Junta este cadastro com um produto existente"
          disabled={busy}
          onClick={onOpenMerge}
        />

        {kind === "none" && !isRecipe && !dismissed ? (
          <SetupActionButton
            icon={<Ban className="size-4" />}
            label="Não é um item de agrupamento"
            hint="Some a tag de possível agrupamento"
            disabled={busy}
            onClick={() => setConfirmNotGrouping(true)}
          />
        ) : null}

        {dismissed ? (
          <SetupActionButton
            icon={<Ban className="size-4" />}
            label="Desfazer: pode ser agrupamento"
            hint="Volta a sugerir possível agrupamento"
            disabled={busy}
            onClick={() => void markNotGrouping(false)}
          />
        ) : null}
      </div>

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
              {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDemote} onOpenChange={setConfirmDemote}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deixar de ser agrupamento?</AlertDialogTitle>
            <AlertDialogDescription>
              {productName ? `«${productName}»` : "Este produto"} volta a ser
              item comum. As variantes ligadas serão desvinculadas. A venda
              volta a baixar este SKU.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void demote();
              }}
            >
              {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmNotGrouping}
        onOpenChange={setConfirmNotGrouping}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Não é um item de agrupamento?</AlertDialogTitle>
            <AlertDialogDescription>
              A tag de possível agrupamento some e o sync não a recoloca. Você
              ainda pode tornar agrupamento ou vincular depois, se mudar de
              ideia.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void markNotGrouping(true);
              }}
            >
              {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SaleFamilyLinkSheet
        open={linkOpen}
        onOpenChange={setLinkOpen}
        companyId={companyId}
        familyProductId={kind === "family" ? productId : null}
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
