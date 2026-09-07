import {
  MergeFactorChoiceList,
  MergeProductConversionsEditor,
} from "@/components/products/MergeProductConversionsEditor";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { systemUnitLabel } from "@/lib/companyUnits/systemUnits";
import {
  incomingEffectiveFactor,
  type IncomingFactorDraft,
} from "@/lib/mergeIncomingFactor";
import {
  convertLoserQuantityToWinner,
  draftsToConversionRows,
  listMergeUnitFactorCandidates,
  resolveMergeUnitFactor,
} from "@/lib/mergeProductUnits";
import type { Product } from "@/types/product";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

function unitLabel(code: string) {
  const c = code.trim().toLowerCase();
  const label = systemUnitLabel(c);
  return label !== c ? `${label} (${c})` : c;
}

export function ProductMergeIncomingRow({
  companyId,
  winner,
  loser,
  winnerConversions,
  draft,
  onChange,
  conversionsLoading,
}: {
  companyId: string;
  winner: Product;
  loser: Product;
  winnerConversions: ProductUnitConversionDraft[];
  draft: IncomingFactorDraft;
  onChange: (next: IncomingFactorDraft) => void;
  conversionsLoading: boolean;
}) {
  const sameHub =
    winner.unit.trim().toLowerCase() === loser.unit.trim().toLowerCase();
  const [showConversions, setShowConversions] = useState(!sameHub);

  const candidates = useMemo(
    () =>
      listMergeUnitFactorCandidates({
        winnerHub: winner.unit,
        winnerConversions: draftsToConversionRows(winnerConversions),
        loserHub: loser.unit,
        loserConversions: draftsToConversionRows(draft.conversions),
        winnerName: winner.name,
        loserName: loser.name,
      }),
    [winner, loser, winnerConversions, draft.conversions],
  );

  const resolved = useMemo(
    () =>
      resolveMergeUnitFactor({
        winnerHub: winner.unit,
        winnerConversions: draftsToConversionRows(winnerConversions),
        loserHub: loser.unit,
        loserConversions: draftsToConversionRows(draft.conversions),
      }),
    [winner, loser, winnerConversions, draft.conversions],
  );

  useEffect(() => {
    if (conversionsLoading) return;
    if (draft.factorMode === "manual") return;
    if (candidates.length === 0) {
      onChange({ ...draft, factorMode: "manual", selectedFactorId: null });
      return;
    }
    if (
      draft.selectedFactorId &&
      candidates.some((c) => c.id === draft.selectedFactorId)
    ) {
      return;
    }
    const nextId =
      resolved.kind === "same"
        ? (candidates.find((c) => c.id === "same")?.id ?? candidates[0]!.id)
        : resolved.kind === "auto"
          ? (candidates.find(
              (c) => Math.abs(c.factor - resolved.factor) < 1e-6,
            )?.id ?? candidates[0]!.id)
          : candidates[0]!.id;
    if (nextId !== draft.selectedFactorId) {
      onChange({ ...draft, selectedFactorId: nextId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só escolhe o fator inicial
  }, [conversionsLoading, candidates, resolved.kind, draft.selectedFactorId, draft.factorMode]);

  const factor = incomingEffectiveFactor(
    winner,
    loser,
    winnerConversions,
    draft,
  );
  const converted =
    factor != null
      ? convertLoserQuantityToWinner(Number(loser.current_quantity), factor)
      : null;

  return (
    <div className="space-y-3 rounded-xl border border-destructive/25 bg-destructive/5 p-3">
      <div>
        <p className="text-[0.65rem] font-bold uppercase tracking-wider text-destructive">
          Entra neste cadastro
        </p>
        <p className="mt-1 font-semibold leading-snug">{loser.name}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {Number(loser.current_quantity).toLocaleString("pt-BR")} {loser.unit}
          {converted != null
            ? ` → ${converted.toLocaleString("pt-BR", { maximumFractionDigits: 4 })} ${winner.unit}`
            : ""}
        </p>
      </div>
      {conversionsLoading ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Carregando conversão…
        </p>
      ) : sameHub && !showConversions ? (
        <p className="text-xs text-muted-foreground">
          Mesma unidade de estoque — entra 1:1.{" "}
          <button
            type="button"
            className="font-medium text-foreground underline-offset-2 hover:underline"
            onClick={() => setShowConversions(true)}
          >
            Ajustar conversão
          </button>
        </p>
      ) : (
        <>
          {sameHub ? (
            <button
              type="button"
              className="text-xs font-medium text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => {
                setShowConversions(false);
                onChange({
                  ...draft,
                  factorMode: "candidate",
                  selectedFactorId: "same",
                });
              }}
            >
              Usar 1:1 (mesma unidade)
            </button>
          ) : null}
          <MergeProductConversionsEditor
            companyId={companyId}
            productId={loser.id}
            productName={loser.name}
            stockUnitCode={loser.unit}
            value={draft.conversions}
            onChange={(conversions) => onChange({ ...draft, conversions })}
          />
          <MergeFactorChoiceList
            candidates={candidates}
            selectedId={draft.selectedFactorId}
            onSelect={(id) =>
              onChange({
                ...draft,
                factorMode: "candidate",
                selectedFactorId: id,
              })
            }
            manualSelected={draft.factorMode === "manual"}
            onSelectManual={() => onChange({ ...draft, factorMode: "manual" })}
          />
          {draft.factorMode === "manual" ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Qtd. ({loser.unit})</Label>
                <Input
                  className="w-24"
                  inputMode="decimal"
                  value={draft.manualLoserQty}
                  onChange={(e) =>
                    onChange({ ...draft, manualLoserQty: e.target.value })
                  }
                />
              </div>
              <span className="pb-2 text-sm text-muted-foreground">
                {unitLabel(loser.unit)} =
              </span>
              <div className="space-y-1">
                <Label className="text-xs">Qtd. ({winner.unit})</Label>
                <Input
                  className="w-24"
                  inputMode="decimal"
                  value={draft.manualWinnerQty}
                  onChange={(e) =>
                    onChange({ ...draft, manualWinnerQty: e.target.value })
                  }
                />
              </div>
              <span className="pb-2 text-sm text-muted-foreground">
                {unitLabel(winner.unit)}
              </span>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
