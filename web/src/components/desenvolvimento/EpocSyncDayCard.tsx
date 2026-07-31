import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCompany } from "@/contexts/CompanyContext";
import {
  downloadTextAsFile,
  invokeEpocSyncDay,
  pollEpocSyncDayStatus,
  yesterdayIsoSaoPaulo,
  type EpocSyncDayOk,
} from "@/services/epocSyncDayService";
import { CalendarRange, Download, Loader2, Play, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

function stampFile(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

function firstDayPrevMonthIsoSaoPaulo(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const y = Number(parts.find((p) => p.type === "year")?.value ?? "1970");
  const m = Number(parts.find((p) => p.type === "month")?.value ?? "1");
  const prevM = m === 1 ? 12 : m - 1;
  const prevY = m === 1 ? y - 1 : y;
  return `${prevY}-${String(prevM).padStart(2, "0")}-01`;
}

function csvNonEmpty(
  csv: EpocSyncDayOk["csv"] | undefined,
): boolean {
  if (!csv) return false;
  return !!(
    csv.produtos?.trim() ||
    csv.faturamento?.trim() ||
    csv.servicos?.trim()
  );
}

function formatProgressLabel(st: EpocSyncDayOk): string {
  const done = st.days_done ?? 0;
  const planned = st.days_planned ?? 0;
  const t = st.stats ?? st.totals;
  const statsBit = t
    ? ` · ok ${t.dias_ok} · skip ${t.dias_skipped_no_faturamento} · erro ${t.dias_erro}`
    : "";
  if (st.continuing || st.status === "fetching") {
    return `A sincronizar… ${done}/${planned} dias (lote ${st.chain_attempt ?? "?"})${statsBit}`;
  }
  if (st.status === "done") return "Concluído — CSVs disponíveis";
  return st.message ?? `Estado: ${st.status ?? "?"}`;
}

export function EpocSyncDayCard() {
  const { currentCompany } = useCompany();
  const yesterday = yesterdayIsoSaoPaulo();
  const [dataDe, setDataDe] = useState(firstDayPrevMonthIsoSaoPaulo);
  const [dataAte, setDataAte] = useState(yesterday);
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [result, setResult] = useState<EpocSyncDayOk | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [previewKind, setPreviewKind] = useState<
    "produtos" | "servicos" | "faturamento" | null
  >(null);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);
  const runIdRef = useRef<string | null>(null);
  const prefixRef = useRef<string | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const finishingRef = useRef(false);
  const pollInFlightRef = useRef(false);

  const busy = loading || polling || resuming;
  const showPreview = !busy && csvNonEmpty(result?.csv);
  const previewCsv = useMemo(() => {
    if (!result || !previewKind || !result.csv || busy) return "";
    return result.csv[previewKind] ?? "";
  }, [result, previewKind, busy]);

  const canDownload = showPreview;

  const stopPoll = () => {
    if (pollTimerRef.current != null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    setPolling(false);
  };

  useEffect(() => () => stopPoll(), []);

  const applyProgress = (st: EpocSyncDayOk, syncRunId: string) => {
    const done = st.days_done ?? 0;
    const planned = st.days_planned ?? 0;
    setProgressLabel(formatProgressLabel(st));
    setResult({
      ok: true,
      continuing: st.continuing === true || st.status === "fetching",
      sync_run_id: st.sync_run_id ?? syncRunId,
      chain_attempt: st.chain_attempt,
      days_done: done,
      days_planned: planned,
      days_label: st.days_label ?? `${done}/${planned} dias`,
      days: st.days,
      totals: st.totals,
      stats: st.stats ?? st.totals,
      storage_bucket: st.storage_bucket,
      storage_prefix: st.storage_prefix,
      // Paths/CSV finais só no fim — evita pré-visualização da run anterior.
      storage_paths: st.continuing || st.status === "fetching"
        ? undefined
        : st.storage_paths,
      csv_import_job_id: st.csv_import_job_id,
      csv_import_error: st.csv_import_error,
      csv: st.continuing || st.status === "fetching" ? undefined : st.csv,
      message: st.message,
      status: st.status,
      last_error: st.last_error,
      has_csv:
        st.continuing || st.status === "fetching"
          ? false
          : (st.has_csv ?? csvNonEmpty(st.csv)),
    });
    if (st.storage_prefix) prefixRef.current = st.storage_prefix;
  };

  const applyFinal = (res: EpocSyncDayOk) => {
    finishingRef.current = false;
    setResult({ ...res, continuing: false });
    setPreviewKind("produtos");
    setProgressLabel(null);
    stopPoll();
    setLoading(false);
    const t = res.stats ?? res.totals;
    if (csvNonEmpty(res.csv)) {
      toast.success(
        `Sync-day concluído — CSVs prontos (ok ${t?.dias_ok ?? 0} · skip ${t?.dias_skipped_no_faturamento ?? 0} · prod ${t?.produtos_rows ?? 0})`,
      );
    } else {
      toast.message(
        "Sync-day concluído, mas CSVs ainda vazios — use «Recarregar CSVs».",
      );
    }
  };

  const tickPoll = async (companyId: string, syncRunId: string) => {
    if (finishingRef.current || pollInFlightRef.current) return;
    pollInFlightRef.current = true;
    try {
      const st = await pollEpocSyncDayStatus({
        companyId,
        syncRunId,
        stepsPrefix: prefixRef.current ?? undefined,
      });
      if (!st.ok) {
        setErrorMsg(st.error);
        return;
      }

      const stillRunning =
        st.continuing === true || st.status === "fetching";
      applyProgress(st, syncRunId);

      if (stillRunning) return;

      if (st.status === "failed") {
        stopPoll();
        setLoading(false);
        setErrorMsg(st.last_error ?? "Cadeia falhou.");
        toast.error(st.last_error ?? "Cadeia sync-day falhou.");
        return;
      }

      const done = st.days_done ?? 0;
      const planned = st.days_planned ?? 0;
      const complete =
        st.status === "done" ||
        (planned > 0 && done >= planned) ||
        st.has_csv === true ||
        csvNonEmpty(st.csv);

      if (complete) {
        finishingRef.current = true;
        applyFinal({
          ...st,
          ok: true,
          continuing: false,
          status: "done",
        });
      }
    } finally {
      pollInFlightRef.current = false;
    }
  };

  const startPoll = (companyId: string, syncRunId: string) => {
    runIdRef.current = syncRunId;
    finishingRef.current = false;
    setPolling(true);
    setLoading(true);
    if (pollTimerRef.current != null) {
      window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    void tickPoll(companyId, syncRunId);
    // Poll mais frequente enquanto o servidor grava progresso por dia.
    pollTimerRef.current = window.setInterval(() => {
      void tickPoll(companyId, syncRunId);
    }, 2_500);
  };

  const applyProgressRef = useRef(applyProgress);
  applyProgressRef.current = applyProgress;
  const startPollRef = useRef(startPoll);
  startPollRef.current = startPoll;

  // Ao voltar à tela / trocar unidade: retoma cadeia em curso.
  useEffect(() => {
    if (!currentCompany) return;
    let cancelled = false;

    (async () => {
      setResuming(true);
      setProgressLabel("A verificar sincronização em curso…");
      try {
        const st = await pollEpocSyncDayStatus({
          companyId: currentCompany.id,
        });
        if (cancelled) return;
        if (!st.ok) {
          setProgressLabel(null);
          return;
        }
        const running =
          st.continuing === true || st.status === "fetching";
        if (!running || !st.sync_run_id) {
          setProgressLabel(null);
          return;
        }
        if (st.storage_prefix) prefixRef.current = st.storage_prefix;
        runIdRef.current = st.sync_run_id;
        applyProgressRef.current(st, st.sync_run_id);
        startPollRef.current(currentCompany.id, st.sync_run_id);
      } catch {
        if (!cancelled) setProgressLabel(null);
      } finally {
        if (!cancelled) setResuming(false);
      }
    })();

    return () => {
      cancelled = true;
      if (pollTimerRef.current != null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [currentCompany?.id]);

  const reloadCsvs = async () => {
    if (!currentCompany) return;
    setProgressLabel("A recarregar CSVs a partir do Storage…");
    const prefix =
      prefixRef.current ??
      result?.storage_prefix ??
      undefined;
    const st = await pollEpocSyncDayStatus({
      companyId: currentCompany.id,
      syncRunId: runIdRef.current ?? result?.sync_run_id ?? undefined,
      stepsPrefix: prefix,
      forceRebuildCsv: true,
    });
    if (!st.ok) {
      toast.error(st.error);
      setProgressLabel(null);
      return;
    }
    setResult({
      ...(result ?? { ok: true }),
      ...st,
      ok: true,
      continuing: false,
    });
    if (st.storage_prefix) prefixRef.current = st.storage_prefix;
    if (csvNonEmpty(st.csv)) {
      setPreviewKind("produtos");
      toast.success("CSVs carregados a partir do Storage.");
    } else {
      toast.message(
        "Ainda sem CSV. Confirme se existem ficheiros em …/parts/ no Storage.",
      );
    }
    setProgressLabel(null);
    setLoading(false);
    stopPoll();
  };

  const run = async () => {
    if (!currentCompany) {
      toast.error("Selecione uma unidade no menu.");
      return;
    }
    if (!dataDe || !dataAte) {
      toast.error("Informe data de e data até.");
      return;
    }
    if (dataDe > dataAte) {
      toast.error("A data inicial não pode ser posterior à final.");
      return;
    }

    stopPoll();
    finishingRef.current = false;
    setLoading(true);
    setErrorMsg(null);
    setResult(null);
    setPreviewKind(null);
    setProgressLabel("A iniciar sync-day…");
    prefixRef.current = null;
    runIdRef.current = null;
    try {
      const res = await invokeEpocSyncDay({
        companyId: currentCompany.id,
        dataDeIso: dataDe,
        dataAteIso: dataAte,
        maxDaysPerInvoke: 2,
      });
      if (!res.ok) {
        toast.error(res.error);
        setErrorMsg(res.error);
        setLoading(false);
        setProgressLabel(null);
        return;
      }

      if (res.storage_prefix) prefixRef.current = res.storage_prefix;
      if (res.sync_run_id) runIdRef.current = res.sync_run_id;

      if (res.continuing === true && res.sync_run_id) {
        applyProgress(res, res.sync_run_id);
        toast.message("Cadeia sync-day em curso (auto-continuação).");
        startPoll(currentCompany.id, res.sync_run_id);
        return;
      }

      applyFinal(res);
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Erro ao chamar epoc-sync-day.";
      toast.error(msg);
      setErrorMsg(msg);
      setLoading(false);
      setProgressLabel(null);
    }
  };

  const downloadOne = (kind: "produtos" | "servicos" | "faturamento") => {
    const body = result?.csv?.[kind]?.trim() ?? "";
    if (!body) {
      toast.message(`CSV de ${kind} vazio — tente «Recarregar CSVs».`);
      return;
    }
    downloadTextAsFile(body, `epoc-sync-day-${kind}-${stampFile()}.csv`);
  };

  const downloadAll = () => {
    downloadOne("produtos");
    downloadOne("servicos");
    downloadOne("faturamento");
  };

  const totals = result?.stats ?? result?.totals;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarRange className="size-4" />
          EPOC — sync-day (produtos + serviços + faturamento)
        </CardTitle>
        <CardDescription>
          Percorre o período em lotes (2 dias/invocação), busca os 3 módulos em
          paralelo, salta dias sem faturamento e auto-continua até o fim. No
          término libera CSVs para download.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="epoc-sync-day-de">Data de</Label>
            <Input
              id="epoc-sync-day-de"
              type="date"
              value={dataDe}
              onChange={(e) => setDataDe(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="epoc-sync-day-ate">Data até</Label>
            <Input
              id="epoc-sync-day-ate"
              type="date"
              value={dataAte}
              onChange={(e) => setDataAte(e.target.value)}
              disabled={busy}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => void run()}
            disabled={busy || !currentCompany}
          >
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {resuming
                  ? "A retomar…"
                  : polling
                    ? "Em cadeia…"
                    : "Sincronizando…"}
              </>
            ) : (
              <>
                <Play className="size-4" />
                Disparar epoc-sync-day
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void reloadCsvs()}
            disabled={!currentCompany || busy}
          >
            <RefreshCw className="size-4" />
            Recarregar CSVs
          </Button>
          {canDownload ? (
            <Button type="button" variant="outline" onClick={downloadAll}>
              <Download className="size-4" />
              Baixar os 3 CSVs
            </Button>
          ) : null}
        </div>

        {progressLabel ? (
          <p className="text-sm font-medium text-sky-800 dark:text-sky-200">
            {progressLabel}
          </p>
        ) : null}

        {errorMsg ? (
          <p className="text-destructive text-sm">{errorMsg}</p>
        ) : null}

        {result ? (
          <div className="space-y-3 rounded-md border bg-muted/30 p-3 text-sm">
            <p>
              <span className="font-medium">Janela:</span>{" "}
              {result.days_label ??
                `${result.days_done ?? "?"}/${result.days_planned ?? "?"} dias`}
              {result.sync_run_id ? (
                <>
                  {" "}
                  · run <code className="text-xs">{result.sync_run_id}</code>
                </>
              ) : null}
            </p>
            {totals ? (
              <p>
                <span className="font-medium">Stats:</span> ok {totals.dias_ok} ·
                skip {totals.dias_skipped_no_faturamento} · erro{" "}
                {totals.dias_erro} · produtos {totals.produtos_rows} · serviços{" "}
                {totals.servicos_rows} · faturamento {totals.faturamento_rows}
              </p>
            ) : null}
            {busy ? (
              <p className="text-muted-foreground text-xs">
                Progresso actualizado a cada dia processado. CSVs e paths
                ficam disponíveis no fim da cadeia.
              </p>
            ) : null}
            {!busy && result.storage_prefix ? (
              <p className="text-muted-foreground text-xs break-all">
                Storage: {result.storage_bucket ?? "company-setup"}/
                {result.storage_prefix}
              </p>
            ) : null}
            {!busy && result.storage_paths ? (
              <p className="text-muted-foreground text-xs break-all">
                Paths: prod={result.storage_paths.produtos ?? "—"} · serv=
                {result.storage_paths.servicos ?? "—"} · fat=
                {result.storage_paths.faturamento ?? "—"}
              </p>
            ) : null}

            {result.days?.length ? (
              <div className="space-y-1">
                <p className="font-medium">
                  Dias processados ({result.days.length}
                  {result.days_planned != null
                    ? `/${result.days_planned}`
                    : ""}
                  )
                </p>
                <ul className="list-inside list-disc text-muted-foreground max-h-40 overflow-auto">
                  {result.days.slice(-40).map((d) => (
                    <li key={`${d.date_br}-${d.status}`}>
                      {d.date_br} · {d.status}
                      {d.produtos_rows != null
                        ? ` · prod ${d.produtos_rows}`
                        : ""}
                      {d.servicos_rows != null
                        ? ` · serv ${d.servicos_rows}`
                        : ""}
                      {d.faturamento_rows != null
                        ? ` · fat ${d.faturamento_rows}`
                        : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {canDownload ? (
              <>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ["produtos", "Produtos"],
                      ["servicos", "Serviços"],
                      ["faturamento", "Faturamento"],
                    ] as const
                  ).map(([kind, label]) => (
                    <div key={kind} className="flex gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant={previewKind === kind ? "default" : "secondary"}
                        onClick={() => setPreviewKind(kind)}
                      >
                        Ver {label}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => downloadOne(kind)}
                      >
                        <Download className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
                {previewKind ? (
                  <div className="space-y-1">
                    <p className="font-medium">
                      Pré-visualização — {previewKind} (
                      {previewCsv.split(/\r?\n/).filter(Boolean).length}{" "}
                      linha(s))
                    </p>
                    <pre className="max-h-64 overflow-auto rounded border bg-background p-2 text-xs whitespace-pre-wrap">
                      {previewCsv.slice(0, 12_000) || "(vazio)"}
                      {previewCsv.length > 12_000 ? "\n…" : ""}
                    </pre>
                  </div>
                ) : null}
              </>
            ) : busy ? null : (
              <p className="text-amber-800 dark:text-amber-300 text-sm">
                CSVs ainda não carregados no painel. Se a cadeia já terminou no
                servidor, clique em <strong>Recarregar CSVs</strong>.
              </p>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
