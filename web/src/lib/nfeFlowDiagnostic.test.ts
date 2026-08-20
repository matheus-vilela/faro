import { describe, expect, it } from "vitest";
import {
  buildNfeCycleFlowDiagnostic,
  buildNfeQueuedFlowDiagnostic,
  canMarkOnboardingFiscalCompleted,
} from "../../../supabase/functions/_shared/nfeFlowDiagnostic.ts";
import { inferNfeFlowDiagnosticFromHistory } from "./nfeFlowDiagnostic";

describe("buildNfeQueuedFlowDiagnostic", () => {
  it("marca busca em curso ao enfileirar", () => {
    const d = buildNfeQueuedFlowDiagnostic();
    expect(d.phases.nfe_search.status).toBe("pending");
    expect(d.phases.xml_download.status).toBe("skipped");
    expect(d.blocked_at).toBeNull();
  });
});

describe("buildNfeCycleFlowDiagnostic", () => {
  it("marca falha na busca", () => {
    const d = buildNfeCycleFlowDiagnostic({
      searchFailed: true,
      searchError: "SEFAZ indisponível",
      listed: 0,
      downloaded: 0,
      processed: 0,
      processFailed: 0,
    });
    expect(d.blocked_at).toBe("nfe_search");
    expect(d.phases.xml_download.status).toBe("skipped");
  });

  it("conclui sem NF-e novas", () => {
    const d = buildNfeCycleFlowDiagnostic({
      listed: 0,
      downloaded: 0,
      processed: 0,
      processFailed: 0,
    });
    expect(d.blocked_at).toBeNull();
    expect(d.phases.nfe_search.status).toBe("warn");
    expect(d.phases.xml_interpret.status).toBe("skipped");
  });

  it("marca as 3 fases ok quando processa tudo", () => {
    const d = buildNfeCycleFlowDiagnostic({
      listed: 5,
      downloaded: 5,
      processed: 5,
      processFailed: 0,
    });
    expect(d.blocked_at).toBeNull();
    expect(d.phases.nfe_search.status).toBe("ok");
    expect(d.phases.xml_download.status).toBe("ok");
    expect(d.phases.xml_interpret.status).toBe("ok");
  });

  it("marca interpretação com falha", () => {
    const d = buildNfeCycleFlowDiagnostic({
      listed: 3,
      downloaded: 3,
      processed: 0,
      processFailed: 3,
    });
    expect(d.blocked_at).toBe("xml_interpret");
    expect(d.phases.xml_interpret.status).toBe("fail");
  });

  it("marca interpretação em curso enquanto faltar notas", () => {
    const d = buildNfeCycleFlowDiagnostic({
      listed: 28,
      downloaded: 28,
      processed: 0,
      processFailed: 0,
    });
    expect(d.phases.xml_download.status).toBe("ok");
    expect(d.phases.xml_interpret.status).toBe("pending");
    expect(d.phases.xml_interpret.message).toBe("0/28 nota(s) interpretadas.");
  });
});

describe("canMarkOnboardingFiscalCompleted", () => {
  it("não fecha o onboarding só porque a 1.ª página já foi interpretada", () => {
    expect(
      canMarkOnboardingFiscalCompleted({
        listExhausted: false,
        downloaded: 50,
        processed: 50,
      }),
    ).toBe(false);
  });

  it("fecha só quando a listagem esgotou e tudo foi interpretado", () => {
    expect(
      canMarkOnboardingFiscalCompleted({
        listExhausted: true,
        downloaded: 274,
        processed: 274,
      }),
    ).toBe(true);
  });
});

describe("inferNfeFlowDiagnosticFromHistory", () => {
  it("reusa snapshot flow_diagnostic", () => {
    const frozen = buildNfeCycleFlowDiagnostic({
      listed: 2,
      downloaded: 2,
      processed: 2,
      processFailed: 0,
    });
    const d = inferNfeFlowDiagnosticFromHistory({
      nfesEncontradas: 2,
      flowDiagnostic: frozen,
    });
    expect(d.phases.xml_interpret.status).toBe("ok");
  });

  it("reconstrói diagnóstico quando o snapshot ficou atrás dos contadores", () => {
    const stale = buildNfeCycleFlowDiagnostic({
      listed: 28,
      downloaded: 28,
      processed: 0,
      processFailed: 0,
    });
    expect(stale.phases.xml_interpret.status).toBe("pending");
    const d = inferNfeFlowDiagnosticFromHistory({
      nfesEncontradas: 28,
      flowDiagnostic: stale,
      listedCount: 28,
      downloadedCount: 28,
      processedCount: 28,
      failedCount: 0,
    });
    expect(d.phases.xml_interpret.status).toBe("ok");
    expect(d.phases.xml_interpret.message).toBe("28 nota(s) interpretada(s).");
  });
});
