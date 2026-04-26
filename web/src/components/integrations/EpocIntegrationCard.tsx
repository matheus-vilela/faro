import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/lib/supabase";
import {
  invokeEpocCsvSync,
  triggerEpocCsvSyncInBackground,
} from "@/services/epocSyncCsvService";
import { cn } from "@/lib/utils";
import {
  mergeEpocSettingsForUpsert,
  parseEpocSettings,
  type CompanyIntegrationRow,
  type EpocAmbiente,
  type EpocIntegrationSettings,
} from "@/types/companyIntegration";
import {
  ChevronRight,
  Download,
  FileText,
  Loader2,
  RefreshCw,
  Save,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

export function EpocIntegrationCard({ companyId }: { companyId: string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const [enabled, setEnabled] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [codigoFilial, setCodigoFilial] = useState("");
  const [ambiente, setAmbiente] = useState<EpocAmbiente>("producao");
  const [existingPassword, setExistingPassword] = useState<string | null>(null);
  const [lastEpocCsvSyncAt, setLastEpocCsvSyncAt] = useState<string | null>(null);
  const [lastEpocCsvStoragePath, setLastEpocCsvStoragePath] = useState<
    string | null
  >(null);
  const [lastEpocAcoesResponseSyncAt, setLastEpocAcoesResponseSyncAt] = useState<
    string | null
  >(null);
  const [lastEpocAcoesResponseStoragePath, setLastEpocAcoesResponseStoragePath] =
    useState<string | null>(null);
  const [downloadingLastCsv, setDownloadingLastCsv] = useState(false);
  const [downloadingLastAcoes, setDownloadingLastAcoes] = useState(false);
  const [syncingFull, setSyncingFull] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("company_integrations")
      .select("*")
      .eq("company_id", companyId)
      .eq("provider", "epoc")
      .maybeSingle();

    if (error) {
      console.error(error);
      toast.error("Não foi possível carregar a integração EPOC.");
      setLoading(false);
      return;
    }

    if (data) {
      const r = data as CompanyIntegrationRow;
      setEnabled(r.enabled);
      const s = parseEpocSettings(
        (r.settings ?? {}) as Record<string, unknown>,
      );
      setUsername(s.username);
      setPassword("");
      setBaseUrl(s.base_url ?? "");
      setCodigoFilial(s.codigo_filial ?? "");
      setAmbiente(s.ambiente ?? "producao");
      setExistingPassword(s.password && s.password.length > 0 ? s.password : null);
      setLastEpocCsvSyncAt(s.last_epoc_csv_sync_at ?? null);
      setLastEpocCsvStoragePath(s.last_epoc_csv_storage_path ?? null);
      setLastEpocAcoesResponseSyncAt(s.last_epoc_acoes_response_sync_at ?? null);
      setLastEpocAcoesResponseStoragePath(
        s.last_epoc_acoes_response_storage_path ?? null,
      );
    } else {
      setEnabled(false);
      setUsername("");
      setPassword("");
      setBaseUrl("");
      setCodigoFilial("");
      setAmbiente("producao");
      setExistingPassword(null);
      setLastEpocCsvSyncAt(null);
      setLastEpocCsvStoragePath(null);
      setLastEpocAcoesResponseSyncAt(null);
      setLastEpocAcoesResponseStoragePath(null);
    }
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const fileNameFromStoragePath = (path: string, fallback: string) => {
    const t = path.trim();
    const i = t.lastIndexOf("/");
    return (i >= 0 ? t.slice(i + 1) : t) || fallback;
  };

  const handleDownloadLastCsv = async () => {
    if (!lastEpocCsvStoragePath?.trim()) {
      toast.error("Ainda não há CSV sincronizado para esta unidade.");
      return;
    }
    setDownloadingLastCsv(true);
    const { data, error } = await supabase.storage
      .from("company-setup")
      .download(lastEpocCsvStoragePath.trim());
    setDownloadingLastCsv(false);
    if (error) {
      console.error(error);
      toast.error(
        error.message || "Não foi possível baixar o arquivo. Verifique as permissões.",
      );
      return;
    }
    const name = fileNameFromStoragePath(lastEpocCsvStoragePath, "epoc-ultimo.csv");
    const url = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    a.click();
    URL.revokeObjectURL(url);
    toast.message(`Download iniciado: ${name}`);
  };

  const handleDownloadLastAcoesResponse = async () => {
    if (!lastEpocAcoesResponseStoragePath?.trim()) {
      toast.error("Ainda não há ficheiro da tabela #tblExport sincronizado.");
      return;
    }
    setDownloadingLastAcoes(true);
    const { data, error } = await supabase.storage
      .from("company-setup")
      .download(lastEpocAcoesResponseStoragePath.trim());
    setDownloadingLastAcoes(false);
    if (error) {
      console.error(error);
      toast.error(
        error.message || "Não foi possível baixar o ficheiro. Verifique as permissões.",
      );
      return;
    }
    const name = fileNameFromStoragePath(
      lastEpocAcoesResponseStoragePath,
      "epoc-tblExport.html",
    );
    const url = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    a.click();
    URL.revokeObjectURL(url);
    toast.message(`Download iniciado: ${name}`);
  };

  const handleSyncNow = async () => {
    if (!enabled || !baseUrl.trim()) {
      toast.error("Ative a integração e indique a URL base do portal EPOC.");
      return;
    }
    setSyncingFull(true);
    const res = await invokeEpocCsvSync(companyId);
    setSyncingFull(false);
    if (res.steps?.length) {
      console.groupCollapsed(`[epoc-sync-csv] steps (${res.steps.length})`);
      for (const s of res.steps) {
        console.info(
          `#${s.index} ${s.name} [${s.status}] http=${s.http_status ?? "-"} bytes=${s.bytes ?? 0}`,
          { url: s.download_url, message: s.message, detalhes: s.detalhes },
        );
      }
      console.groupEnd();
    }
    if (!res.ok) {
      const lastFail = [...(res.steps ?? [])]
        .reverse()
        .find((s) => s.status !== "ok");
      const downloadOnErr =
        lastFail?.download_url ??
        res.acoes_response_download_url ??
        res.html_download_url ??
        null;
      const failName = lastFail?.label ?? lastFail?.name;
      const tail = failName
        ? ` Etapa com problema: ${failName}.`
        : "";
      if (downloadOnErr) {
        toast.error(
          (res.error ?? "Falha na sincronização.") +
            tail +
            " A resposta foi guardada — abrindo o download.",
        );
        await load();
        window.open(downloadOnErr, "_blank", "noopener,noreferrer");
        return;
      }
      toast.error(
        (res.error ?? "Falha na sincronização. Veja os logs da função epoc-sync-csv.") +
          tail,
      );
      return;
    }
    toast.success(
      res.csv_uploaded
        ? "Tabela #tblExport (HTML) e CSV guardados no armazenamento da unidade."
        : "Tabela #tblExport (HTML) guardada. O CSV não foi extraído automaticamente.",
    );
    await load();
    const acoesUrl =
      res.acoes_response_download_url ?? res.html_download_url ?? null;
    if (acoesUrl) {
      window.open(acoesUrl, "_blank", "noopener,noreferrer");
    } else if (res.download_url) {
      window.open(res.download_url, "_blank", "noopener,noreferrer");
    } else {
      toast.message("Use os botões de download abaixo se o browser bloqueou pop-ups.", {
        duration: 5000,
      });
    }
  };

  const handleSave = async () => {
    const u = username.trim();
    if (!u) {
      toast.error("Informe o usuário EPOC.");
      return;
    }
    if (enabled && !existingPassword && !password.trim()) {
      toast.error("Informe a senha ou desative a integração até configurar.");
      return;
    }

    setSaving(true);

    const { data: prevRow } = await supabase
      .from("company_integrations")
      .select("settings")
      .eq("company_id", companyId)
      .eq("provider", "epoc")
      .maybeSingle();

    const settings: EpocIntegrationSettings = {
      username: u,
      base_url: baseUrl.trim() || undefined,
      codigo_filial: codigoFilial.trim() || undefined,
      ambiente,
    };
    const pwd = password.trim();
    if (pwd) {
      settings.password = pwd;
    } else if (existingPassword) {
      settings.password = existingPassword;
    }

    const merged = mergeEpocSettingsForUpsert(
      prevRow?.settings as Record<string, unknown> | undefined,
      settings,
    );

    const payload = {
      company_id: companyId,
      provider: "epoc" as const,
      enabled,
      settings: merged,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from("company_integrations").upsert(
      payload,
      { onConflict: "company_id,provider" },
    );

    setSaving(false);
    if (error) {
      console.error(error);
      toast.error(error.message || "Erro ao salvar.");
      return;
    }

    toast.success("Integração EPOC salva.");
    setPassword("");
    await load();
    setSheetOpen(false);

    if (enabled && baseUrl.trim()) {
      triggerEpocCsvSyncInBackground(companyId);
      toast.message(
        "Sincronização EPOC (epoc-sync-csv) em segundo plano: login, relatório e exportação do CSV.",
        { duration: 6000 },
      );
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex justify-center py-14">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card
        className={cn(
          "overflow-hidden transition-shadow hover:shadow-md",
          enabled
            ? "border-emerald-500/35 ring-1 ring-emerald-500/20"
            : "border-border/80",
        )}
      >
        <div className="flex min-h-22 items-stretch">
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-4 p-5 text-left transition-colors",
              "hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            )}
          >
            <div
              className={cn(
                "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border text-sm font-bold tracking-tight",
                enabled
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-400"
                  : "border-border bg-muted/50 text-muted-foreground",
              )}
            >
              E
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold tracking-tight text-foreground">
                EPOC
              </p>
              <p className="text-sm text-muted-foreground line-clamp-2">
                Por enquanto, importa só vendas realizadas. Sincronização automática
                uma vez ao dia.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {enabled ? (
                <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-400">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.25)]"
                    aria-hidden
                  />
                  Ativo
                </span>
              ) : (
                <span className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/60 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <span
                    className="h-2 w-2 rounded-full bg-muted-foreground/50"
                    aria-hidden
                  />
                  Inativo
                </span>
              )}
              <ChevronRight className="h-5 w-5 text-muted-foreground" aria-hidden />
            </div>
          </button>
          {lastEpocCsvStoragePath ? (
            <div className="flex shrink-0 flex-col justify-center border-l border-border/80 p-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-10 w-10 shrink-0"
                onClick={() => void handleDownloadLastCsv()}
                disabled={downloadingLastCsv}
                title="Baixar último CSV"
                aria-label="Baixar último CSV EPOC"
              >
                {downloadingLastCsv ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
              </Button>
            </div>
          ) : null}
        </div>
      </Card>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Integração EPOC</SheetTitle>
            <SheetDescription>
              URL do portal, usuário, senha e código de filial (NaoMenu). A função
              no servidor (epoc-sync-csv) executa o login e o fluxo de exportação
              do relatório em CSV. Somente quem administra a unidade vê estes
              campos.
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-1 flex-col gap-5 py-2">
            <div className="flex items-center justify-between rounded-lg border border-border/80 bg-muted/25 px-3 py-3">
              <div>
                <Label htmlFor="epoc-enabled" className="text-sm font-medium">
                  Integração ativa
                </Label>
                <p className="text-xs text-muted-foreground">
                  Quando ativo, o Faro usa estas credenciais na rotina que importa
                  vendas do EPOC (execução diária automática).
                </p>
              </div>
              <Switch
                id="epoc-enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="epoc-base-url">URL base (portal EPOC)</Label>
              <Input
                id="epoc-base-url"
                type="url"
                placeholder="https://… ou http://…:porta"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                autoComplete="off"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="epoc-user">Usuário</Label>
                <Input
                  id="epoc-user"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Login EPOC"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="epoc-pass">Senha</Label>
                <PasswordInput
                  id="epoc-pass"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={
                    existingPassword
                      ? "Deixe em branco para manter a atual"
                      : "Senha"
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="epoc-filial">Código da filial</Label>
                <Input
                  id="epoc-filial"
                  value={codigoFilial}
                  onChange={(e) => setCodigoFilial(e.target.value)}
                  placeholder="Ex.: 123A (enviado como NaoMenu)"
                />
                <p className="text-xs text-muted-foreground">
                  Se vazio, o servidor usa 123A como padrão.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Ambiente</Label>
                <Select
                  value={ambiente}
                  onValueChange={(v) => setAmbiente(v as EpocAmbiente)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="producao">Produção</SelectItem>
                    <SelectItem value="homologacao">Homologação</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2 rounded-lg border border-border/80 bg-muted/15 p-3">
              <p className="text-sm font-medium">Relatório EPOC (tabela + CSV)</p>
              {lastEpocAcoesResponseSyncAt ? (
                <p className="text-xs text-muted-foreground">
                  Última tabela (#tblExport):{" "}
                  {new Date(lastEpocAcoesResponseSyncAt).toLocaleString("pt-BR")}
                </p>
              ) : null}
              {lastEpocCsvSyncAt ? (
                <p className="text-xs text-muted-foreground">
                  Último CSV: {new Date(lastEpocCsvSyncAt).toLocaleString("pt-BR")}
                </p>
              ) : !lastEpocAcoesResponseSyncAt ? (
                <p className="text-xs text-muted-foreground">
                  Nada sincronizado ainda — use o botão abaixo (função
                  <span className="font-mono text-[0.7rem]"> epoc-sync-csv</span>).
                </p>
              ) : null}
              <Button
                type="button"
                className="w-full"
                onClick={() => void handleSyncNow()}
                disabled={!enabled || !baseUrl.trim() || syncingFull}
              >
                {syncingFull ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Sincronizar agora (EPOC → Storage)
              </Button>
              <p className="text-xs text-muted-foreground">
                Após o login, a função envia <span className="font-mono text-[0.7rem]">validadorOz.php</span> (NaoMenu e
                token) e, em seguida, <span className="font-mono text-[0.7rem]">acoes.php</span>, com
                o token e o período; extrai só a tabela{" "}
                <span className="font-mono text-[0.7rem]">#tblExport</span> para um ficheiro
                HTML e tenta ainda obter o CSV. URLs assinadas (1h) se o browser abrir o separador.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  onClick={() => void handleDownloadLastAcoesResponse()}
                  disabled={!lastEpocAcoesResponseStoragePath || downloadingLastAcoes}
                >
                  {downloadingLastAcoes ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FileText className="mr-2 h-4 w-4" />
                  )}
                  Baixar tabela (#tblExport)
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  onClick={() => void handleDownloadLastCsv()}
                  disabled={!lastEpocCsvStoragePath || downloadingLastCsv}
                >
                  {downloadingLastCsv ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}
                  Baixar último CSV
                </Button>
              </div>
            </div>
          </div>

          <SheetFooter className="gap-2 border-t pt-4 sm:flex-col sm:space-x-0">
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                className="w-full sm:w-auto"
                onClick={() => void handleSave()}
                disabled={saving}
              >
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Salvar
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
