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
import { cn } from "@/lib/utils";
import {
  parseEpocSettings,
  type CompanyIntegrationRow,
  type EpocAmbiente,
  type EpocIntegrationSettings,
} from "@/types/companyIntegration";
import { ChevronRight, Loader2, Save } from "lucide-react";
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
    } else {
      setEnabled(false);
      setUsername("");
      setPassword("");
      setBaseUrl("");
      setCodigoFilial("");
      setAmbiente("producao");
      setExistingPassword(null);
    }
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

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

    const payload = {
      company_id: companyId,
      provider: "epoc" as const,
      enabled,
      settings: settings as unknown as Record<string, unknown>,
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
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className={cn(
            "flex w-full items-center gap-4 p-5 text-left transition-colors",
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
      </Card>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Integração EPOC</SheetTitle>
            <SheetDescription>
              Usuário, senha e parâmetros de ambiente. Somente gestores e
              proprietários acessam estas informações. No momento, esta
              integração apenas busca as vendas realizadas no EPOC; a
              sincronização é executada automaticamente uma vez por dia.
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
              <Label htmlFor="epoc-base-url">URL base (API ou portal)</Label>
              <Input
                id="epoc-base-url"
                type="url"
                placeholder="https://…"
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
                <Label htmlFor="epoc-filial">Código da filial (opcional)</Label>
                <Input
                  id="epoc-filial"
                  value={codigoFilial}
                  onChange={(e) => setCodigoFilial(e.target.value)}
                  placeholder="Ex.: 001"
                />
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
          </div>

          <SheetFooter className="gap-2 border-t pt-4 sm:flex-col sm:space-x-0">
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
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
