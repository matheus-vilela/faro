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
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import { SaleFamilyLinkSheet } from "@/components/products/SaleFamilyLinkSheet";
import {
  fetchSaleFamilyCandidates,
  linkSaleFamilyVariant,
  listSaleFamilyForProduct,
  promoteProductToSaleFamily,
  demoteProductFromSaleFamily,
  setProductNotSaleGrouping,
  unlinkSaleFamilyVariant,
  type SaleFamilyInfo,
  type SaleFamilyProductOption,
} from "@/lib/productSaleFamily";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const NONE = "none";
const SELF = "self";
const NOT_GROUPING = "not_grouping";
const FICHA_NO = "no";
const FICHA_SALE = "sale";
const FICHA_INTERMEDIATE = "intermediate";
const MERGE_NONE = "";

export function ProductSetupCard({
  companyId,
  productId,
  productName,
  stockControlType,
  notSaleGrouping,
  possibleGrouping,
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
  possibleGrouping?: boolean;
  hasTechnicalSheet?: boolean;
  className?: string;
  onOpenTechnicalSheet: (kind: "sale" | "intermediate") => void;
  onOpenMerge: (partnerId?: string) => void;
  onChanged?: () => void;
}) {
  const [info, setInfo] = useState<SaleFamilyInfo | null>(null);
  const [families, setFamilies] = useState<SaleFamilyProductOption[]>([]);
  const [mergeOptions, setMergeOptions] = useState<
    Array<{ id: string; name: string; sku: string | null }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmPromote, setConfirmPromote] = useState(false);
  const [confirmDemote, setConfirmDemote] = useState(false);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [linkMembersOpen, setLinkMembersOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [family, cands, mergeRows] = await Promise.all([
        listSaleFamilyForProduct(companyId, productId),
        fetchSaleFamilyCandidates(companyId, []),
        supabase
          .from("products")
          .select("id, name, sku")
          .eq("company_id", companyId)
          .eq("is_active", true)
          .eq("listed_in_product_catalog", true)
          .neq("id", productId)
          .order("name")
          .limit(400),
      ]);
      setInfo(family);
      setFamilies(cands.filter((p) => p.id !== productId));
      if (mergeRows.error) throw mergeRows.error;
      setMergeOptions(
        (mergeRows.data ?? []) as Array<{
          id: string;
          name: string;
          sku: string | null;
        }>,
      );
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Falha ao ler a configuração.",
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
  const isIntermediate = stockControlType === "INTERMEDIATE";
  const isFamily = kind === "family" || stockControlType === "SALE_FAMILY";
  const fichaValue = isIntermediate
    ? FICHA_INTERMEDIATE
    : hasTechnicalSheet || isRecipe
      ? FICHA_SALE
      : FICHA_NO;
  const inGrouping = kind === "variant";
  const dismissed = Boolean(notSaleGrouping) && kind === "none" && !isRecipe;
  const familyId = info?.family?.id ?? null;
  const memberCount = info?.members.length ?? 0;

  const groupingValue = isFamily
    ? SELF
    : inGrouping && familyId
      ? familyId
      : dismissed
        ? NOT_GROUPING
        : NONE;

  const groupingLeading = useMemo(() => {
    const rows = [
      {
        value: NONE,
        label: "Nenhum",
        description: "Só produto, sem agrupamento",
      },
    ];
    if (possibleGrouping && !dismissed && !isFamily && !inGrouping) {
      rows.push({
        value: NOT_GROUPING,
        label: "Não é agrupamento",
        description: "Some a tag de possível agrupamento",
      });
    }
    if (dismissed) {
      rows.push({
        value: NOT_GROUPING,
        label: "Não é agrupamento",
        description: "Sugestão escondida",
      });
    }
    if (!isRecipe && !isIntermediate && !inGrouping) {
      rows.push({
        value: SELF,
        label: "Este produto é o agrupamento",
        description: "Venda de cardápio sem baixa neste SKU",
      });
    }
    return rows;
  }, [possibleGrouping, dismissed, isFamily, inGrouping, isRecipe, isIntermediate]);

  const groupingOptions = useMemo(() => {
    if (isFamily || isRecipe) return [];
    return families.map((p) => ({
      value: p.id,
      label: p.name,
      description:
        p.stock_control_type === "SALE_FAMILY"
          ? p.sku
            ? `Agrupamento · SKU ${p.sku}`
            : "Agrupamento"
          : p.sku
            ? `SKU ${p.sku} · vira agrupamento ao ligar`
            : "Vira agrupamento ao ligar",
      keywords: p.sku ?? "",
    }));
  }, [families, isFamily, isRecipe]);

  const applyGrouping = async (next: string) => {
    if (next === groupingValue || busy) return;

    if (next === SELF) {
      setConfirmPromote(true);
      return;
    }
    if (next === NONE || next === NOT_GROUPING) {
      if (isFamily) {
        setConfirmDemote(true);
        return;
      }
      if (inGrouping) {
        setConfirmUnlink(true);
        return;
      }
      if (next === NOT_GROUPING && !dismissed) {
        setBusy(true);
        try {
          await setProductNotSaleGrouping(productId, true);
          toast.success("Marcado: não é agrupamento.");
          onChanged?.();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
        } finally {
          setBusy(false);
        }
      }
      if (next === NONE && dismissed) {
        setBusy(true);
        try {
          await setProductNotSaleGrouping(productId, false);
          toast.success("Pode ser agrupamento de novo.");
          onChanged?.();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
        } finally {
          setBusy(false);
        }
      }
      return;
    }

    setBusy(true);
    try {
      if (inGrouping && familyId && familyId !== next) {
        await unlinkSaleFamilyVariant(companyId, productId);
      }
      await linkSaleFamilyVariant({
        companyId,
        familyProductId: next,
        variantName: productName ?? "Produto",
        qtyPerSale: 1,
        variantProductId: productId,
      });
      toast.success("Produto ligado ao agrupamento. Continua no cadastro.");
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível vincular.");
    } finally {
      setBusy(false);
    }
  };

  const promote = async () => {
    setBusy(true);
    try {
      await promoteProductToSaleFamily(productId);
      toast.success("Este produto agora é o agrupamento. A venda não baixa estoque.");
      setConfirmPromote(false);
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível promover.");
    } finally {
      setBusy(false);
    }
  };

  const demote = async () => {
    setBusy(true);
    try {
      await demoteProductFromSaleFamily(productId);
      toast.success("Deixou de ser agrupamento. Continua sendo produto.");
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

  const unlinkSelf = async () => {
    setBusy(true);
    try {
      await unlinkSaleFamilyVariant(companyId, productId);
      toast.success("Saiu do agrupamento. Continua sendo produto.");
      setConfirmUnlink(false);
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível desvincular.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn("space-y-3", className)}>
      <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
        Configuração
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="min-w-0 space-y-1.5">
          <Label className="text-xs text-muted-foreground">Agrupamento</Label>
          <SearchSelect
            value={groupingValue}
            onValueChange={(v) => void applyGrouping(v)}
            disabled={loading || busy || isRecipe}
            placeholder="Nenhum"
            searchPlaceholder="Buscar agrupamento…"
            leadingOptions={groupingLeading}
            options={groupingOptions}
            contentClassName="z-[200]"
          />
          {isFamily ? (
            <button
              type="button"
              className="text-xs text-primary underline-offset-2 hover:underline"
              onClick={() => setLinkMembersOpen(true)}
            >
              {memberCount === 0
                ? "Ligar produtos"
                : `${memberCount} produto${memberCount === 1 ? "" : "s"} ligado${memberCount === 1 ? "" : "s"}`}
            </button>
          ) : null}
        </div>

        <div className="min-w-0 space-y-1.5">
          <Label className="text-xs text-muted-foreground">Ficha técnica</Label>
          <SearchSelect
            value={fichaValue}
            onValueChange={(v) => {
              if (v === FICHA_SALE) onOpenTechnicalSheet("sale");
              if (v === FICHA_INTERMEDIATE) onOpenTechnicalSheet("intermediate");
            }}
            disabled={loading || busy || isFamily}
            placeholder="Não"
            searchPlaceholder="Filtrar…"
            options={[
              {
                value: FICHA_NO,
                label: "Não",
                description: "Sem ficha",
              },
              {
                value: FICHA_SALE,
                label: "Ficha normal",
                description: "Na venda, baixa os insumos",
              },
              {
                value: FICHA_INTERMEDIATE,
                label: "Produto intermediário",
                description: "Produz, estoca e baixa o produto na venda",
              },
            ]}
            contentClassName="z-[200]"
          />
          {fichaValue !== FICHA_NO ? (
            <button
              type="button"
              className="text-xs text-primary underline-offset-2 hover:underline"
              onClick={() =>
                onOpenTechnicalSheet(
                  fichaValue === FICHA_INTERMEDIATE
                    ? "intermediate"
                    : "sale",
                )
              }
            >
              Editar ficha
            </button>
          ) : null}
        </div>

        <div className="min-w-0 space-y-1.5">
          <Label className="text-xs text-muted-foreground">Unificar com</Label>
          <SearchSelect
            value={MERGE_NONE}
            onValueChange={(v) => {
              if (v) onOpenMerge(v);
            }}
            disabled={loading || busy}
            placeholder="Escolher produto…"
            searchPlaceholder="Buscar produto…"
            leadingOptions={[
              {
                value: MERGE_NONE,
                label: "Nenhum",
                description: "Não unificar agora",
              },
            ]}
            options={mergeOptions.map((p) => ({
              value: p.id,
              label: p.name,
              description: p.sku ? `SKU ${p.sku}` : undefined,
              keywords: p.sku ?? "",
            }))}
            contentClassName="z-[200]"
          />
        </div>
      </div>

      {loading || busy ? (
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          {loading ? "Carregando…" : "Salvando…"}
        </p>
      ) : null}

      <AlertDialog open={confirmPromote} onOpenChange={setConfirmPromote}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Este produto é o agrupamento?</AlertDialogTitle>
            <AlertDialogDescription>
              A venda de {productName ? `«${productName}»` : "este item"} gera
              receita e <strong>não baixa</strong> estoque. A baixa vem do
              relatório do dia, nos produtos ligados.
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
              Volta a ser só produto. Os vínculos são desfeitos e a venda volta
              a baixar este SKU.
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
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmUnlink} onOpenChange={setConfirmUnlink}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sair do agrupamento?</AlertDialogTitle>
            <AlertDialogDescription>
              Continua sendo produto. Só deixa de fazer parte de{" "}
              {info?.family?.name ?? "este agrupamento"}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void unlinkSelf();
              }}
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SaleFamilyLinkSheet
        open={linkMembersOpen}
        onOpenChange={setLinkMembersOpen}
        companyId={companyId}
        familyProductId={isFamily ? productId : null}
        onLinked={() => {
          void load();
          onChanged?.();
        }}
      />
    </div>
  );
}
