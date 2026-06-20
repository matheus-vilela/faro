import { cn } from "@/lib/utils";

function str(v: unknown): string {
  if (v == null) return "";
  const s = String(v).trim();
  return s;
}

function trunc(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

const RESOLUTION_STATUS_PT: Record<string, string> = {
  AUTO_MATCH: "Correspondência automática",
  PENDING_USER_CONFIRM: "Aguardando sua confirmação",
  UNIT_CONFLICT_PENDING: "Pendência: unidades incompatíveis",
  UNIT_VALIDATION_REQUIRED: "Pendência: validação de unidade",
  NEW_PRODUCT_STAGED: "Novo produto (rascunho)",
};

const DECISION_PATH_PT: Record<string, string> = {
  scored_catalog: "Catálogo ordenado por similaridade",
  exact_normalized_name: "Nome normalizado idêntico",
  catalog_empty_or_no_candidates: "Catálogo vazio ou sem candidato",
  borderline_llm_link: "IA sugeriu vínculo (faixa intermediária)",
  borderline_llm_new_hint: "IA sugeriu nome novo (faixa intermediária)",
  borderline_llm_skip: "IA não decidiu vínculo",
  borderline_llm_error: "Erro na assistência por IA",
  import_llm_cold_new: "IA: produto novo (sem candidato seguro)",
  import_llm_cold_fallback: "Fallback: nome da nota (IA)",
  import_llm_cold_fallback_error: "Fallback após erro de IA",
  import_batch_deterministic_new: "Lote: cadastro automático (sem candidato seguro)",
  import_batch_borderline_llm_skip_auto_new: "Lote: IA ignorou vínculo; nome da nota",
  import_batch_borderline_llm_error_auto_new: "Lote: erro de IA; nome da nota",
  import_batch_no_openai_key: "Lote: sem chave OpenAI",
  scored_borderline_no_llm: "Faixa intermediária sem IA",
};

const AI_KIND_PT: Record<string, string> = {
  LINK: "Vínculo a produto",
  NEW_PRODUCT: "Novo produto",
  SKIP: "Sem decisão",
  UNCERTAIN: "Incerto",
  ERROR: "Erro",
};

function translateResolutionStatus(code: string): string {
  return RESOLUTION_STATUS_PT[code] ?? code;
}

function translateDecisionPath(code: string): string {
  return DECISION_PATH_PT[code] ?? code;
}

function translateAiKind(kind: string): string {
  return AI_KIND_PT[kind] ?? kind;
}

/** Compatibilidade com pendências gravadas antes da tradução no motor. */
function localizeMatchReasonText(s: string): string {
  const pairs: [RegExp, string][] = [
    [/\(UNIT_VALIDATION_REQUIRED\)/g, "(validação de unidade necessária)"],
    [/\(DIRECT_UNIT_MATCH\)/g, "(mesma unidade, sem conversão)"],
    [/\(UNKNOWN_INVOICE_UNIT\)/g, "(unidade da nota ausente ou não reconhecida)"],
    [/\(AUTO_CONVERTED_GLOBAL_RULE\)/g, "(conversão global massa/volume)"],
    [/\(AUTO_CONVERTED_PRODUCT_RULE\)/g, "(regra de conversão do produto)"],
    [/\bScore\b/g, "Pontuação"],
  ];
  let o = s;
  for (const [re, rep] of pairs) o = o.replace(re, rep);
  return o;
}

/**
 * Detalhe estilo laboratório XML: o que veio na nota vs o que o motor e a IA guardaram no `product_match`.
 */
export function ImportPendingProductMatchDetail({
  payload,
  className,
}: {
  payload: Record<string, unknown> | null;
  className?: string;
}) {
  const pm = (payload?.product_match as Record<string, unknown> | null) ?? null;
  const xmlName = str(payload?.xml_product_name);
  const ilu = (pm?.invoice_line_units_llm as Record<string, unknown> | null) ?? null;

  if (!xmlName && !pm && !ilu) return null;

  const invUnit = str(pm?.invoiceUnitNormalized);
  const catUnit = str(pm?.catalogUnitNormalized);
  const resSt = str(pm?.resolutionStatus);
  const score = pm?.suggestedScore != null && Number.isFinite(Number(pm.suggestedScore))
    ? Number(pm.suggestedScore)
    : null;
  const sugName = str(pm?.suggestedProductName);
  const sugId = str(pm?.suggestedProductId);
  const matchReason = trunc(localizeMatchReasonText(str(pm?.matchReason)), 360);
  const path = str(pm?.decisionPath);

  const aiKind = str(ilu?.kind);
  const aiClean = str(ilu?.cleaned_product_name);
  const aiTarget = str(ilu?.catalog_unit_target);
  const aiConf =
    ilu?.confidence != null && Number.isFinite(Number(ilu.confidence))
      ? Number(ilu.confidence)
      : null;
  const aiInterp = trunc(str(ilu?.interpretation), 420);

  return (
    <div
      className={cn(
        "mt-2 grid gap-2 rounded-md border border-border/80 bg-muted/30 p-3 text-xs sm:text-sm",
        className,
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Nota vs motor vs IA
      </p>
      {xmlName ? (
        <p>
          <span className="text-muted-foreground">Na NF (descrição): </span>
          <span className="font-medium text-foreground">{xmlName}</span>
        </p>
      ) : null}
      {(invUnit || catUnit) && (
        <p>
          <span className="text-muted-foreground">Unidades (motor): </span>
          <span className="tabular-nums text-foreground">
            nota {invUnit || "—"} → catálogo {catUnit || "—"}
            {pm?.unitConvertible === true ? (
              <span className="ml-1 text-emerald-700 dark:text-emerald-400">(conversível)</span>
            ) : null}
          </span>
        </p>
      )}
      {(resSt || score != null || sugName || sugId || matchReason || path) && (
        <div className="space-y-1 rounded border border-border/60 bg-background/60 px-2 py-1.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Motor (código + match)
          </p>
          {resSt ? (
            <p>
              <span className="text-muted-foreground">Estado: </span>
              <span className="text-foreground">{translateResolutionStatus(resSt)}</span>
              {score != null ? (
                <span className="ml-2 text-muted-foreground">
                  pontuação{" "}
                  <span className="font-semibold text-foreground">{score}</span>
                </span>
              ) : null}
            </p>
          ) : null}
          {path ? (
            <p className="text-muted-foreground">
              Percurso: <span className="text-foreground">{translateDecisionPath(path)}</span>
            </p>
          ) : null}
          {sugName || sugId ? (
            <p>
              <span className="text-muted-foreground">Candidato no catálogo: </span>
              <span className="font-medium text-foreground">{sugName || "—"}</span>
              {sugId ? (
                <span className="ml-1 font-mono text-[10px] text-muted-foreground">{sugId.slice(0, 8)}…</span>
              ) : null}
            </p>
          ) : null}
          {matchReason ? (
            <p className="text-muted-foreground leading-snug">
              <span className="font-medium text-foreground/90">Motivo: </span>
              {matchReason}
            </p>
          ) : null}
        </div>
      )}
      {(ilu && (aiKind || aiClean || aiTarget || aiInterp || aiConf != null)) ? (
        <div className="space-y-1 rounded border border-primary/20 bg-primary/[0.06] px-2 py-1.5 dark:bg-primary/10">
          <p className="text-[11px] font-medium uppercase tracking-wide text-primary">
            IA (unidade / nome de linha)
          </p>
          {aiKind ? (
            <p>
              <span className="text-muted-foreground">Tipo: </span>
              <span>{translateAiKind(aiKind)}</span>
              {aiConf != null ? (
                <span className="ml-2 text-muted-foreground">
                  confiança <span className="font-semibold">{aiConf}</span>
                </span>
              ) : null}
            </p>
          ) : null}
          {aiClean ? (
            <p>
              <span className="text-muted-foreground">Nome limpo: </span>
              <span className="font-medium text-foreground">{aiClean}</span>
            </p>
          ) : null}
          {aiTarget ? (
            <p>
              <span className="text-muted-foreground">Unidade alvo sugerida: </span>
              <span className="font-mono text-[11px]">{aiTarget}</span>
            </p>
          ) : null}
          {aiInterp ? (
            <p className="leading-snug text-muted-foreground">
              <span className="font-medium text-foreground/90">Interpretação: </span>
              {aiInterp}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
