/**
 * Diagnóstico do pipeline fiscal em 3 fases:
 * busca SEFAZ → download XML → interpretação.
 */

export type NfeFlowPhase = "nfe_search" | "xml_download" | "xml_interpret";

export type NfeFlowPhaseStatus =
  | "ok"
  | "warn"
  | "fail"
  | "pending"
  | "skipped";

export type NfeFlowPhaseReport = {
  status: NfeFlowPhaseStatus;
  label: string;
  message?: string;
};

export type NfeFlowDiagnostic = {
  blocked_at: NfeFlowPhase | null;
  summary: string;
  phases: Record<NfeFlowPhase, NfeFlowPhaseReport>;
};

export const NFE_FLOW_PHASE_ORDER: NfeFlowPhase[] = [
  "nfe_search",
  "xml_download",
  "xml_interpret",
];

export const NFE_FLOW_PHASE_LABELS: Record<NfeFlowPhase, string> = {
  nfe_search: "Busca de notas fiscais",
  xml_download: "Download dos XMLs",
  xml_interpret: "Interpretação das notas",
};

function phase(
  name: NfeFlowPhase,
  status: NfeFlowPhaseStatus,
  message?: string,
): NfeFlowPhaseReport {
  return {
    status,
    label: NFE_FLOW_PHASE_LABELS[name],
    ...(message ? { message } : {}),
  };
}

function buildDiagnostic(
  phases: Record<NfeFlowPhase, NfeFlowPhaseReport>,
  blockedAt: NfeFlowPhase | null,
  summary: string,
): NfeFlowDiagnostic {
  return { blocked_at: blockedAt, summary, phases };
}

export type NfeCycleFlowDiagnosticInput = {
  /** Falha na API Focus/SEFAZ antes de listar. */
  searchFailed?: boolean;
  searchError?: string | null;
  /** Itens elegíveis no ciclo (não ignorados). */
  listed: number;
  /** XMLs baixados no Storage. */
  downloaded: number;
  /** Falhas de download. */
  downloadFailed?: number;
  /** Notas interpretadas com sucesso. */
  processed: number;
  /** Falhas de interpretação. */
  processFailed: number;
  /** Notas ignoradas (não autorizada/completa). */
  ignored?: number;
};

/** Diagnóstico inicial ao enfileirar (antes do worker processar). */
export function buildNfeQueuedFlowDiagnostic(): NfeFlowDiagnostic {
  return buildDiagnostic(
    {
      nfe_search: phase(
        "nfe_search",
        "pending",
        "Consulta enfileirada; aguardando busca na SEFAZ.",
      ),
      xml_download: phase(
        "xml_download",
        "skipped",
        "Aguardando conclusão da busca.",
      ),
      xml_interpret: phase(
        "xml_interpret",
        "skipped",
        "Aguardando conclusão da busca.",
      ),
    },
    null,
    "Consulta NF-e enfileirada; busca na SEFAZ em curso ou na fila.",
  );
}

/** Monta o diagnóstico a partir dos agregados do ciclo. */
export function buildNfeCycleFlowDiagnostic(
  input: NfeCycleFlowDiagnosticInput,
): NfeFlowDiagnostic {
  const listed = Math.max(0, Number(input.listed) || 0);
  const downloaded = Math.max(0, Number(input.downloaded) || 0);
  const downloadFailed = Math.max(0, Number(input.downloadFailed ?? 0) || 0);
  const processed = Math.max(0, Number(input.processed) || 0);
  const processFailed = Math.max(0, Number(input.processFailed) || 0);
  const ignored = Math.max(0, Number(input.ignored ?? 0) || 0);
  const skipped = (name: NfeFlowPhase) =>
    phase(name, "skipped", "Etapa não executada.");

  if (input.searchFailed) {
    const msg =
      input.searchError?.trim() ||
      "Falha ao consultar a SEFAZ/Focus (rede, token ou indisponibilidade).";
    return buildDiagnostic(
      {
        nfe_search: phase("nfe_search", "fail", msg),
        xml_download: skipped("xml_download"),
        xml_interpret: skipped("xml_interpret"),
      },
      "nfe_search",
      `Problema na busca: ${msg}`,
    );
  }

  const searchMsgParts: string[] = [];
  if (listed > 0) searchMsgParts.push(`${listed} NF-e elegível(is).`);
  if (ignored > 0) searchMsgParts.push(`${ignored} ignorada(s).`);
  const searchMessage =
    listed === 0 && ignored === 0
      ? "Nenhuma NF-e nova na consulta."
      : searchMsgParts.join(" ") || undefined;

  const searchPhase = phase(
    "nfe_search",
    listed === 0 && ignored === 0 ? "warn" : "ok",
    searchMessage,
  );

  if (listed === 0) {
    return buildDiagnostic(
      {
        nfe_search: searchPhase,
        xml_download: skipped("xml_download"),
        xml_interpret: skipped("xml_interpret"),
      },
      null,
      ignored > 0
        ? `Consulta concluída: ${ignored} NF-e ignorada(s); nenhuma elegível.`
        : "Consulta concluída: nenhuma NF-e nova.",
    );
  }

  let downloadPhase: NfeFlowPhaseReport;
  if (downloadFailed > 0 && downloaded === 0) {
    downloadPhase = phase(
      "xml_download",
      "fail",
      `${downloadFailed} XML(s) falharam no download.`,
    );
    return buildDiagnostic(
      {
        nfe_search: searchPhase,
        xml_download: downloadPhase,
        xml_interpret: skipped("xml_interpret"),
      },
      "xml_download",
      `Problema no download: ${downloadFailed} XML(s) falharam.`,
    );
  }

  if (downloadFailed > 0) {
    downloadPhase = phase(
      "xml_download",
      "warn",
      `${downloaded} baixado(s); ${downloadFailed} falha(s).`,
    );
  } else if (downloaded < listed) {
    downloadPhase = phase(
      "xml_download",
      "warn",
      `${downloaded}/${listed} XML(s) baixados.`,
    );
  } else {
    downloadPhase = phase(
      "xml_download",
      "ok",
      `${downloaded} XML(s) baixados.`,
    );
  }

  if (downloaded === 0) {
    return buildDiagnostic(
      {
        nfe_search: searchPhase,
        xml_download: downloadPhase,
        xml_interpret: skipped("xml_interpret"),
      },
      downloadPhase.status === "fail" ? "xml_download" : null,
      "Busca concluída, mas nenhum XML foi baixado.",
    );
  }

  if (processFailed > 0 && processed === 0) {
    return buildDiagnostic(
      {
        nfe_search: searchPhase,
        xml_download: downloadPhase,
        xml_interpret: phase(
          "xml_interpret",
          "fail",
          `${processFailed} nota(s) falharam na interpretação.`,
        ),
      },
      "xml_interpret",
      `Problema na interpretação: ${processFailed} nota(s) falharam.`,
    );
  }

  if (processFailed > 0) {
    return buildDiagnostic(
      {
        nfe_search: searchPhase,
        xml_download: downloadPhase,
        xml_interpret: phase(
          "xml_interpret",
          "warn",
          `${processed} interpretada(s); ${processFailed} falha(s).`,
        ),
      },
      "xml_interpret",
      `Interpretação parcial: ${processed} ok, ${processFailed} falha(s).`,
    );
  }

  if (processed < downloaded) {
    return buildDiagnostic(
      {
        nfe_search: searchPhase,
        xml_download: downloadPhase,
        xml_interpret: phase(
          "xml_interpret",
          "warn",
          `${processed}/${downloaded} nota(s) interpretadas.`,
        ),
      },
      null,
      `Ciclo encerrado com ${processed}/${downloaded} nota(s) interpretadas.`,
    );
  }

  return buildDiagnostic(
    {
      nfe_search: searchPhase,
      xml_download: downloadPhase,
      xml_interpret: phase(
        "xml_interpret",
        "ok",
        `${processed} nota(s) interpretada(s).`,
      ),
    },
    null,
    `${processed} nota(s) processada(s) com sucesso.`,
  );
}
