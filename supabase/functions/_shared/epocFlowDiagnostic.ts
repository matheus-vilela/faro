/**
 * Diagnóstico do pipeline EPOC em 4 fases:
 * login → busca no portal → geração CSV → interpretação/importação.
 */

export type EpocFlowPhase =
  | "portal_login"
  | "portal_search"
  | "csv_creation"
  | "csv_import";

export type EpocFlowPhaseStatus =
  | "ok"
  | "warn"
  | "fail"
  | "pending"
  | "skipped";

export type EpocFlowPhaseReport = {
  status: EpocFlowPhaseStatus;
  label: string;
  message?: string;
};

export type EpocFlowDiagnostic = {
  /** Fase onde o pipeline parou ou falhou; null = concluído sem bloqueio. */
  blocked_at: EpocFlowPhase | null;
  summary: string;
  phases: Record<EpocFlowPhase, EpocFlowPhaseReport>;
};

export const EPOC_FLOW_PHASE_ORDER: EpocFlowPhase[] = [
  "portal_login",
  "portal_search",
  "csv_creation",
  "csv_import",
];

export const EPOC_FLOW_PHASE_LABELS: Record<EpocFlowPhase, string> = {
  portal_login: "Login no portal",
  portal_search: "Busca de receitas no portal",
  csv_creation: "Geração do CSV",
  csv_import: "Interpretação do CSV (importação)",
};

function phase(
  name: EpocFlowPhase,
  status: EpocFlowPhaseStatus,
  message?: string,
): EpocFlowPhaseReport {
  return {
    status,
    label: EPOC_FLOW_PHASE_LABELS[name],
    ...(message ? { message } : {}),
  };
}

function buildDiagnostic(
  phases: Record<EpocFlowPhase, EpocFlowPhaseReport>,
  blockedAt: EpocFlowPhase | null,
  summary: string,
): EpocFlowDiagnostic {
  return { blocked_at: blockedAt, summary, phases };
}

/** Resultado parcial da edge `epoc-sync-csv`. */
export type EpocSyncFlowDiagnosticInput = {
  loginOk: boolean;
  loginError?: string | null;
  conteudoTelaOk?: boolean;
  tblExportFound?: boolean;
  portalSearchSummary?: string | null;
  diasConsultados?: number;
  diasComTabela?: number;
  linhasDados?: number;
  csvUploaded?: boolean;
  csvEmpty?: boolean;
  csvRevenueImportJobId?: string | null;
  csvJobEnqueueFailed?: boolean;
  syncOk?: boolean;
  syncError?: string | null;
};

export function buildEpocSyncFlowDiagnostic(
  input: EpocSyncFlowDiagnosticInput,
): EpocFlowDiagnostic {
  const skipped = (name: EpocFlowPhase) =>
    phase(name, "skipped", "Etapa não executada.");

  if (!input.loginOk) {
    const msg =
      input.loginError?.trim() ||
      "Falha ao autenticar no portal EPOC (URL, usuário ou senha).";
    return buildDiagnostic(
      {
        portal_login: phase("portal_login", "fail", msg),
        portal_search: skipped("portal_search"),
        csv_creation: skipped("csv_creation"),
        csv_import: skipped("csv_import"),
      },
      "portal_login",
      `Problema na busca: login no portal falhou. ${msg}`,
    );
  }

  if (input.conteudoTelaOk === false) {
    const msg =
      "Portal respondeu, mas o módulo de relatório não carregou (sem ConteudoTela). Verifique credenciais, NaoMenu e módulo.";
    return buildDiagnostic(
      {
        portal_login: phase("portal_login", "ok"),
        portal_search: phase("portal_search", "fail", msg),
        csv_creation: skipped("csv_creation"),
        csv_import: skipped("csv_import"),
      },
      "portal_search",
      `Problema na busca: ${msg}`,
    );
  }

  if (input.tblExportFound === false) {
    const msg =
      input.portalSearchSummary?.trim() ||
      (input.diasConsultados === 1
        ? "Nenhuma tabela de exportação (#tblExport) no dia consultado."
        : "Nenhuma tabela de exportação (#tblExport) na janela consultada.");
    return buildDiagnostic(
      {
        portal_login: phase("portal_login", "ok"),
        portal_search: phase("portal_search", "warn", msg),
        csv_creation: skipped("csv_creation"),
        csv_import: skipped("csv_import"),
      },
      "portal_search",
      `Problema na busca: ${msg}`,
    );
  }

  if (
    input.csvUploaded &&
    input.linhasDados != null &&
    input.linhasDados === 0
  ) {
    const dias = input.diasComTabela ?? 0;
    const msg =
      dias > 0
        ? "Portal devolveu tabela, mas nenhuma linha passou no filtro «Total Bruto(R$)»."
        : "CSV exportado sem linhas de dados.";
    return buildDiagnostic(
      {
        portal_login: phase("portal_login", "ok"),
        portal_search: phase(
          "portal_search",
          "ok",
          dias > 0 ? `${dias} dia(s) com #tblExport.` : undefined,
        ),
        csv_creation: phase("csv_creation", "warn", msg),
        csv_import: phase(
          "csv_import",
          "ok",
          "Nenhuma linha a importar; fluxo concluído.",
        ),
      },
      null,
      "CSV sem linhas de dados; importação não necessária.",
    );
  }

  if (input.csvEmpty || !input.csvUploaded) {
    const dias = input.diasComTabela ?? 0;
    const linhas = input.linhasDados ?? 0;
    const msg =
      dias > 0 && linhas === 0
        ? "Portal devolveu tabela, mas nenhuma linha passou no filtro «Total Bruto(R$)»."
        : "CSV consolidado ficou vazio ou não foi guardado no Storage.";
    return buildDiagnostic(
      {
        portal_login: phase("portal_login", "ok"),
        portal_search: phase(
          "portal_search",
          "ok",
          dias > 0
            ? `${dias} dia(s) com #tblExport; ${linhas} linha(s) após filtro.`
            : undefined,
        ),
        csv_creation: phase("csv_creation", "warn", msg),
        csv_import: skipped("csv_import"),
      },
      "csv_creation",
      `Problema na criação do CSV: ${msg}`,
    );
  }

  if (input.csvJobEnqueueFailed) {
    const msg =
      "CSV guardado, mas não foi possível enfileirar a importação de receitas.";
    return buildDiagnostic(
      {
        portal_login: phase("portal_login", "ok"),
        portal_search: phase("portal_search", "ok"),
        csv_creation: phase(
          "csv_creation",
          "ok",
          `${input.linhasDados ?? 0} linha(s) no CSV.`,
        ),
        csv_import: phase("csv_import", "fail", msg),
      },
      "csv_import",
      `Problema na interpretação: ${msg}`,
    );
  }

  if (input.csvRevenueImportJobId) {
    return buildDiagnostic(
      {
        portal_login: phase("portal_login", "ok"),
        portal_search: phase("portal_search", "ok"),
        csv_creation: phase(
          "csv_creation",
          "ok",
          `${input.linhasDados ?? 0} linha(s) exportadas.`,
        ),
        csv_import: phase(
          "csv_import",
          "pending",
          "Importação enfileirada; aguardando processamento.",
        ),
      },
      null,
      "Exportação concluída; importação do CSV em curso ou na fila.",
    );
  }

  if (input.syncOk === false && input.syncError) {
    return buildDiagnostic(
      {
        portal_login: phase("portal_login", "ok"),
        portal_search: phase("portal_search", "fail", input.syncError),
        csv_creation: skipped("csv_creation"),
        csv_import: skipped("csv_import"),
      },
      "portal_search",
      input.syncError,
    );
  }

  return buildDiagnostic(
    {
      portal_login: phase("portal_login", "ok"),
      portal_search: phase("portal_search", "ok"),
      csv_creation: phase("csv_creation", "ok"),
      csv_import: phase("csv_import", "skipped", "Importação não iniciada."),
    },
    null,
    "Sincronização concluída sem enfileirar importação.",
  );
}

export type EpocImportJobFlowDiagnosticInput = {
  status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | string;
  errorMessage?: string | null;
  csvTotalRows?: number;
  revenueCreated?: number;
  rowsSkipped?: number;
  rowsSkippedNoProduct?: number;
};

export function buildEpocImportJobFlowDiagnostic(
  input: EpocImportJobFlowDiagnosticInput,
): EpocFlowDiagnostic {
  const csvRows = input.csvTotalRows ?? 0;
  const created = input.revenueCreated ?? 0;
  const skipped = input.rowsSkipped ?? 0;
  const skippedNoProduct = input.rowsSkippedNoProduct ?? 0;

  const priorOk = phase(
    "portal_search",
    "ok",
    "CSV presente no Storage (exportação já concluída).",
  );

  if (input.status === "FAILED") {
    const msg =
      input.errorMessage?.trim() ||
      "Falha ao interpretar o CSV (colunas, formato ou catálogo).";
    return buildDiagnostic(
      {
        portal_login: phase("portal_login", "ok"),
        portal_search: priorOk,
        csv_creation: phase("csv_creation", "ok", `${csvRows} linha(s) no CSV.`),
        csv_import: phase("csv_import", "fail", msg),
      },
      "csv_import",
      `Problema na interpretação do CSV: ${msg}`,
    );
  }

  if (input.status === "PENDING" || input.status === "PROCESSING") {
    if (csvRows === 0) {
      return buildDiagnostic(
        {
          portal_login: phase("portal_login", "ok"),
          portal_search: priorOk,
          csv_creation: phase("csv_creation", "warn", "CSV sem linhas de dados."),
          csv_import: phase(
            "csv_import",
            "ok",
            "Nenhuma linha a importar; fluxo concluído.",
          ),
        },
        null,
        "CSV sem linhas de dados; importação não necessária.",
      );
    }
    return buildDiagnostic(
      {
        portal_login: phase("portal_login", "ok"),
        portal_search: priorOk,
        csv_creation: phase("csv_creation", "ok", `${csvRows} linha(s) no CSV.`),
        csv_import: phase(
          "csv_import",
          "pending",
          input.status === "PENDING"
            ? "Job na fila."
            : "A processar linhas do CSV.",
        ),
      },
      null,
      "Importação do CSV em curso.",
    );
  }

  if (input.status === "COMPLETED") {
    if (csvRows === 0) {
      return buildDiagnostic(
        {
          portal_login: phase("portal_login", "ok"),
          portal_search: priorOk,
          csv_creation: phase("csv_creation", "warn", "CSV sem linhas de dados."),
          csv_import: phase(
            "csv_import",
            "ok",
            "Nenhuma linha a importar; fluxo concluído.",
          ),
        },
        null,
        "CSV sem linhas de dados; importação concluída sem receitas.",
      );
    }

    if (csvRows > 0 && created === 0 && skipped > 0) {
      const detail =
        skippedNoProduct > 0
          ? `${skipped} linha(s) ignorada(s); ${skippedNoProduct} sem produto resolvido.`
          : `${skipped} linha(s) ignorada(s).`;
      return buildDiagnostic(
        {
          portal_login: phase("portal_login", "ok"),
          portal_search: priorOk,
          csv_creation: phase("csv_creation", "ok", `${csvRows} linha(s) no CSV.`),
          csv_import: phase(
            "csv_import",
            "warn",
            `Nenhuma receita criada. ${detail}`,
          ),
        },
        "csv_import",
        `Problema na interpretação: CSV processado, mas nenhuma receita foi criada. ${detail}`,
      );
    }

    return buildDiagnostic(
      {
        portal_login: phase("portal_login", "ok"),
        portal_search: priorOk,
        csv_creation: phase("csv_creation", "ok"),
        csv_import: phase(
          "csv_import",
          "ok",
          `${created} receita(s) criada(s)${skipped > 0 ? `; ${skipped} ignorada(s)` : ""}.`,
        ),
      },
      null,
      `${created} receita(s) importada(s) do CSV.`,
    );
  }

  return buildDiagnostic(
    {
      portal_login: phase("portal_login", "ok"),
      portal_search: priorOk,
      csv_creation: phase("csv_creation", "ok"),
      csv_import: phase("csv_import", "pending", `Estado: ${input.status}`),
    },
    null,
    "Estado de importação desconhecido.",
  );
}

/**
 * Atualiza a fase 4 (e resumo/bloqueio) de um diagnóstico de exportação
 * quando o job de importação já saiu de «pending».
 * Mantém as fases 1–3 do sync (mais fiéis ao portal).
 */
export function applyImportOutcomeToSyncFlowDiagnostic(
  syncDiagnostic: EpocFlowDiagnostic,
  importDiagnostic: EpocFlowDiagnostic,
): EpocFlowDiagnostic {
  if (syncDiagnostic.phases.csv_import.status !== "pending") {
    return syncDiagnostic;
  }
  if (importDiagnostic.phases.csv_import.status === "pending") {
    return syncDiagnostic;
  }

  const importPhase = importDiagnostic.phases.csv_import;
  const blockedAt =
    importDiagnostic.blocked_at === "csv_import"
      ? ("csv_import" as const)
      : null;

  let summary: string;
  if (importPhase.status === "ok") {
    summary = importDiagnostic.summary?.trim()
      ? `Exportação concluída. ${importDiagnostic.summary}`
      : "Exportação e importação do CSV concluídas.";
  } else if (importPhase.status === "warn" || importPhase.status === "fail") {
    summary = importDiagnostic.summary;
  } else {
    summary = syncDiagnostic.summary;
  }

  return {
    blocked_at: blockedAt,
    summary,
    phases: {
      ...syncDiagnostic.phases,
      csv_import: importPhase,
    },
  };
}
