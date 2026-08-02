import { describe, expect, it } from "vitest";
import {
  applyImportOutcomeToSyncFlowDiagnostic,
  buildEpocImportJobFlowDiagnostic,
  buildEpocSyncFlowDiagnostic,
} from "../../../supabase/functions/_shared/epocFlowDiagnostic.ts";
import { inferEpocFlowDiagnosticFromLegacy } from "./epocFlowDiagnostic";

describe("buildEpocSyncFlowDiagnostic", () => {
  it("marca falha no login", () => {
    const d = buildEpocSyncFlowDiagnostic({
      loginOk: false,
      loginError: "Credenciais inválidas",
    });
    expect(d.blocked_at).toBe("portal_login");
    expect(d.phases.portal_search.status).toBe("skipped");
  });

  it("marca ausência de tblExport na busca", () => {
    const d = buildEpocSyncFlowDiagnostic({
      loginOk: true,
      tblExportFound: false,
      portalSearchSummary: "23/06/2026: sem eventos",
    });
    expect(d.blocked_at).toBe("portal_search");
    expect(d.phases.csv_creation.status).toBe("skipped");
  });

  it("marca CSV vazio na criação", () => {
    const d = buildEpocSyncFlowDiagnostic({
      loginOk: true,
      tblExportFound: true,
      csvUploaded: false,
      csvEmpty: true,
      diasComTabela: 2,
      linhasDados: 0,
    });
    expect(d.blocked_at).toBe("csv_creation");
  });

  it("marca importação pendente após exportação", () => {
    const d = buildEpocSyncFlowDiagnostic({
      loginOk: true,
      tblExportFound: true,
      csvUploaded: true,
      linhasDados: 12,
      csvRevenueImportJobId: "job-1",
    });
    expect(d.blocked_at).toBeNull();
    expect(d.phases.csv_import.status).toBe("pending");
  });

  it("marca importação concluída quando CSV tem 0 linhas", () => {
    const d = buildEpocSyncFlowDiagnostic({
      loginOk: true,
      tblExportFound: true,
      csvUploaded: true,
      linhasDados: 0,
      diasComTabela: 1,
    });
    expect(d.blocked_at).toBeNull();
    expect(d.phases.csv_import.status).toBe("ok");
    expect(d.phases.csv_import.message).toContain("Nenhuma linha");
  });
});

describe("buildEpocImportJobFlowDiagnostic", () => {
  it("marca falha na interpretação", () => {
    const d = buildEpocImportJobFlowDiagnostic({
      status: "FAILED",
      errorMessage: 'Coluna "data_consumo" não encontrada',
    });
    expect(d.blocked_at).toBe("csv_import");
  });

  it("alerta quando nenhuma receita foi criada", () => {
    const d = buildEpocImportJobFlowDiagnostic({
      status: "COMPLETED",
      csvTotalRows: 40,
      revenueCreated: 0,
      rowsSkipped: 40,
      rowsSkippedNoProduct: 35,
    });
    expect(d.blocked_at).toBe("csv_import");
    expect(d.phases.csv_import.status).toBe("warn");
  });

  it("não marca interpretação em curso quando CSV tem 0 linhas", () => {
    const d = buildEpocImportJobFlowDiagnostic({
      status: "PROCESSING",
      csvTotalRows: 0,
    });
    expect(d.phases.csv_import.status).toBe("ok");
    expect(d.phases.csv_import.message).toContain("Nenhuma linha");
    expect(d.blocked_at).toBeNull();
  });
});

describe("applyImportOutcomeToSyncFlowDiagnostic", () => {
  it("atualiza fase 4 pendente quando o job conclui", () => {
    const sync = buildEpocSyncFlowDiagnostic({
      loginOk: true,
      tblExportFound: true,
      csvUploaded: true,
      linhasDados: 72,
      csvRevenueImportJobId: "job-1",
    });
    const imported = buildEpocImportJobFlowDiagnostic({
      status: "COMPLETED",
      csvTotalRows: 72,
      revenueCreated: 72,
      rowsSkipped: 0,
    });
    const merged = applyImportOutcomeToSyncFlowDiagnostic(sync, imported);
    expect(merged.phases.csv_import.status).toBe("ok");
    expect(merged.phases.csv_creation.status).toBe("ok");
    expect(merged.phases.csv_creation.message).toContain("72");
    expect(merged.blocked_at).toBeNull();
    expect(merged.summary).toMatch(/Exportação concluída/i);
  });

  it("mantém pending se o job ainda está na fila", () => {
    const sync = buildEpocSyncFlowDiagnostic({
      loginOk: true,
      tblExportFound: true,
      csvUploaded: true,
      linhasDados: 10,
      csvRevenueImportJobId: "job-1",
    });
    const pending = buildEpocImportJobFlowDiagnostic({
      status: "PENDING",
      csvTotalRows: 10,
    });
    const merged = applyImportOutcomeToSyncFlowDiagnostic(sync, pending);
    expect(merged.phases.csv_import.status).toBe("pending");
  });
});

describe("inferEpocFlowDiagnosticFromLegacy", () => {
  it("não deixa sync_run com fase 4 em curso após job COMPLETED", () => {
    const frozen = buildEpocSyncFlowDiagnostic({
      loginOk: true,
      tblExportFound: true,
      csvUploaded: true,
      linhasDados: 72,
      csvRevenueImportJobId: "job-1",
    });
    const d = inferEpocFlowDiagnosticFromLegacy({
      kind: "sync_run",
      outcome: "success",
      summary: "CSV exportado com 72 linha(s) em 1 dia(s).",
      metadata: {
        flow_diagnostic: frozen,
        csv_revenue_import_job_id: "job-1",
      },
      linkedImportJob: {
        status: "COMPLETED",
        metadata: {
          csv_total_data_rows: 72,
          revenue_entries_created_total: 72,
          rows_skipped_total: 0,
        },
      },
    });
    expect(d.phases.csv_import.status).toBe("ok");
    expect(d.phases.csv_import.message).toMatch(/72 receita/i);
  });
});
