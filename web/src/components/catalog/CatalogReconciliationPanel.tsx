import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  approveClusterMerge,
  approveHighConfidenceClusters,
  fetchClusterMembers,
  fetchDraftClusters,
  fetchDraftClustersByIds,
  fetchRawDescriptions,
  removeRawItemFromCluster,
} from "@/services/onboardingCatalogReconciliationService";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

const STRENGTH_LABEL: Record<string, string> = {
  HIGH_CONFIDENCE_AUTO: "Alta confiança (lote)",
  MEDIUM_CONFIDENCE_REVIEW: "Média — conferir",
  LOW_CONFIDENCE_REVIEW: "Baixa — conferir com cuidado",
};

type MemberLine = { rawId: string; label: string };

export type CatalogReconciliationPanelProps = {
  companyId: string;
  /**
   * `sheet`: pós-import automático (sem rodar de novo / encerrar).
   * `default`: tela rica; pode exibir ações de pipeline manual.
   */
  variant?: "sheet" | "default";
  /** Quando vindo de uma pendência agregada: só estes clusters. */
  clusterIdsFilter?: string[] | null;
  onClustersChanged?: () => void;
};

function isReviewCluster(aiSummary: Record<string, unknown> | null): boolean {
  return aiSummary?.review_required_pair === true;
}

export function CatalogReconciliationPanel({
  companyId,
  variant = "default",
  clusterIdsFilter,
  onClustersChanged,
}: CatalogReconciliationPanelProps) {
  const [loading, setLoading] = useState(false);
  const [clusters, setClusters] = useState<
    Awaited<ReturnType<typeof fetchDraftClusters>>
  >([]);
  const [memberCache, setMemberCache] = useState<Record<string, MemberLine[]>>(
    {},
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const isSheet = variant === "sheet";

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const filter = clusterIdsFilter?.filter(Boolean) ?? null;
      const c =
        filter && filter.length > 0
          ? await fetchDraftClustersByIds(companyId, filter)
          : await fetchDraftClusters(companyId);
      setClusters(c);
      setMemberCache({});
      onClustersChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao carregar clusters.");
    } finally {
      setLoading(false);
    }
  }, [companyId, clusterIdsFilter, onClustersChanged]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMembers = async (clusterId: string) => {
    if (memberCache[clusterId]) return;
    const mem = await fetchClusterMembers(clusterId);
    const rawIds = mem.map((m) => m.raw_item_id);
    const desc = await fetchRawDescriptions(rawIds);
    const lines: MemberLine[] = mem.map((m) => ({
      rawId: m.raw_item_id,
      label: desc.get(m.raw_item_id) ?? m.raw_item_id,
    }));
    setMemberCache((prev) => ({ ...prev, [clusterId]: lines }));
  };

  const handleApprove = async (clusterId: string) => {
    if (!companyId) return;
    setLoading(true);
    const r = await approveClusterMerge(companyId, clusterId);
    setLoading(false);
    if (!r.ok) {
      toast.error(r.error ?? "Não foi possível aprovar o agrupamento.");
      return;
    }
    toast.success("Agrupamento aprovado e produtos unificados.");
    await load();
  };

  const handleSeparate = async (clusterId: string, rawItemId: string) => {
    if (!companyId) return;
    setLoading(true);
    const r = await removeRawItemFromCluster(companyId, clusterId, rawItemId);
    setLoading(false);
    if (!r.ok) {
      toast.error(r.error ?? "Não foi possível separar o item.");
      return;
    }
    toast.success("Item retirado do grupo.");
    setOpenId(null);
    await load();
  };

  const handleBulkHigh = async () => {
    if (!companyId) return;
    setLoading(true);
    const filter = clusterIdsFilter?.filter(Boolean) ?? null;
    const { approved, errors } = await approveHighConfidenceClusters(companyId, {
      clusterIdScope: filter && filter.length > 0 ? filter : null,
    });
    setLoading(false);
    if (errors.length) {
      toast.message(
        `Aprovados: ${approved}. Alguns erros: ${errors.slice(0, 2).join("; ")}`,
      );
    } else {
      toast.success(`Aprovados em lote: ${approved} agrupamento(s) de alta confiança.`);
    }
    await load();
  };

  if (!companyId) return null;

  return (
    <div className="space-y-4">
      {!isSheet ? (
        <div>
          <h3 className="text-sm font-semibold">Reconciliação do catálogo</h3>
          <p className="text-sm text-muted-foreground">
            Revise agrupamentos sugeridos, aprove merges ou separe linhas que não
            pertencem ao mesmo produto.
          </p>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={loading}
          onClick={() => void handleBulkHigh()}
        >
          Aprovar em lote (só alta confiança)
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => void load()}
        >
          Atualizar lista
        </Button>
      </div>

      {clusters.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {loading
            ? "Carregando…"
            : isSheet
              ? "Nenhum grupo pendente para este recorte, ou já foi processado."
              : "Nenhum grupo pendente para revisar."}
        </p>
      ) : (
        <ul className="space-y-3">
          {clusters.map((c) => (
            <li key={c.id}>
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="flex flex-wrap items-start justify-between gap-2 text-base font-semibold">
                    <span className="pr-2">{c.canonical_name_suggested}</span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {isReviewCluster(c.ai_summary) ? (
                        <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-amber-900 dark:text-amber-100">
                          Revisão obrigatória
                        </span>
                      ) : null}
                      <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {STRENGTH_LABEL[c.merge_strength] ?? c.merge_strength}
                      </span>
                    </span>
                  </CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Confiança agregada:{" "}
                    {((c.aggregate_confidence ?? 0) * 100).toFixed(0)}% · Itens:{" "}
                    {c.occurrence_count ?? "—"}
                    {(c.brands_found?.length ?? 0) > 0
                      ? ` · Marcas: ${c.brands_found!.join(", ")}`
                      : ""}
                  </p>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                  <button
                    type="button"
                    className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                    onClick={() => {
                      const next = openId === c.id ? null : c.id;
                      setOpenId(next);
                      if (next) void loadMembers(c.id);
                    }}
                  >
                    {openId === c.id ? "Ocultar linhas" : "Ver linhas importadas"}
                  </button>
                  {openId === c.id ? (
                    <ul className="space-y-2 text-sm text-muted-foreground">
                      {(memberCache[c.id] ?? []).map((line) => (
                        <li
                          key={line.rawId}
                          className="flex flex-col gap-1.5 rounded-md border border-border/60 bg-muted/10 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <span className="text-foreground">{line.label}</span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="shrink-0 self-start sm:self-auto"
                            disabled={loading}
                            onClick={() => void handleSeparate(c.id, line.rawId)}
                          >
                            Separar deste grupo
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {(c.ai_summary?.explanations as string[] | undefined)?.length ? (
                    <p className="text-xs text-muted-foreground">
                      {(c.ai_summary?.explanations as string[])
                        .slice(0, 3)
                        .join(" · ")}
                    </p>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    disabled={loading}
                    onClick={() => void handleApprove(c.id)}
                  >
                    Aprovar este agrupamento
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
