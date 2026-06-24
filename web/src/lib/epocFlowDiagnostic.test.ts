import { describe, expect, it } from "vitest";
import {
  buildEpocImportJobFlowDiagnostic,
  buildEpocSyncFlowDiagnostic,
} from "../../../supabase/functions/_shared/epocFlowDiagnostic.ts";

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
});
