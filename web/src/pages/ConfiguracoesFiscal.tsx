import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StepCertificateForm } from "@/components/unit-setup/steps/StepCertificateForm";
import { useCompany } from "@/contexts/CompanyContext";
import { stripFocusnfeSecrets } from "@/lib/focusNfeSanitize";
import { supabase } from "@/lib/supabase";
import {
  focusAtualizarCertificado,
  hasFocusNfeEmpresaId,
} from "@/services/focusAtualizarCertificadoService";
import { fileToPureBase64 } from "@/services/focusCriaEmpresaService";
import { validateCertificateWithFocusNfe } from "@/services/focusNfeService";
import type {
  CertificateUploadStatus,
  CompanySetupMap,
  FocusNfeMap,
  SetupCertificateState,
} from "@/types/companySetup";
import { AlertTriangle, FileKey, Loader2, Trash2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

function asObj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function formatDatePt(iso: string | undefined): string {
  if (!iso?.trim()) return "—";
  const d = new Date(iso.trim());
  if (Number.isNaN(d.getTime())) return iso.trim();
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function ConfiguracoesFiscal() {
  const { currentCompany, refetchCompanies } = useCompany();
  const companyId = currentCompany?.id;

  const focusRaw = useMemo(
    () => asObj(currentCompany?.focusnfe) as FocusNfeMap,
    [currentCompany?.focusnfe],
  );
  const setupRaw = useMemo(
    () => asObj(currentCompany?.setup) as CompanySetupMap,
    [currentCompany?.setup],
  );
  const certSetup = useMemo(
    () => asObj(setupRaw.certificate),
    [setupRaw.certificate],
  );
  const xmlZip = useMemo(
    () => setupRaw.xml_zip_import,
    [setupRaw.xml_zip_import],
  );
  const onboardingBatchId = useMemo(
    () => String(xmlZip?.job_batch_id ?? "").trim(),
    [xmlZip?.job_batch_id],
  );

  const certValidade = String(focusRaw.certificado_validade ?? "").trim();
  const certAtivo = focusRaw.certificado_ativo === true;
  const hasEmpresaFocus = hasFocusNfeEmpresaId(currentCompany?.focusnfe);
  const certStatusRaw = String(certSetup.status ?? "").trim();
  const certStatus = useMemo<CertificateUploadStatus>(() => {
    if (
      certStatusRaw === "uploaded" ||
      certStatusRaw === "validating" ||
      certStatusRaw === "valid" ||
      certStatusRaw === "invalid"
    ) {
      return certStatusRaw;
    }
    return "not_sent";
  }, [certStatusRaw]);

  const [certFileName, setCertFileName] = useState("");
  const [certBase64, setCertBase64] = useState("");
  const [certPassword, setCertPassword] = useState("");
  const [certSaving, setCertSaving] = useState(false);
  const [removeCertOpen, setRemoveCertOpen] = useState(false);
  const [showCertEditor, setShowCertEditor] = useState(false);

  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purging, setPurging] = useState(false);

  const certView = useMemo<SetupCertificateState | undefined>(() => {
    const status: CertificateUploadStatus = certBase64.trim()
      ? "uploaded"
      : certSaving
        ? "validating"
        : certStatus;
    return {
      status,
      file_name: certFileName || String(certSetup.file_name ?? ""),
      storage_path: String(certSetup.storage_path ?? ""),
      updated_at: String(certSetup.updated_at ?? ""),
    };
  }, [certBase64, certFileName, certSaving, certSetup, certStatus]);

  const resetCertForm = useCallback(() => {
    setCertFileName("");
    setCertBase64("");
    setCertPassword("");
  }, []);

  const handleCertFile = async (f: File) => {
    if (!f) {
      setCertFileName("");
      setCertBase64("");
      return;
    }
    const lower = f.name.toLowerCase();
    if (!lower.endsWith(".pfx") && !lower.endsWith(".p12")) {
      toast.error("Use um arquivo .pfx ou .p12 (certificado A1).");
      return;
    }
    try {
      const b64 = await fileToPureBase64(f);
      setCertBase64(b64);
      setCertFileName(f.name);
    } catch {
      toast.error("Não foi possível ler o arquivo do certificado.");
      setCertFileName("");
      setCertBase64("");
    }
  };

  const handleSaveCertificate = async () => {
    if (!companyId) return;
    if (!hasEmpresaFocus) {
      toast.error(
        "A unidade ainda não está vinculada à Focus NFe (crie a empresa na Focus antes).",
      );
      return;
    }
    if (!certBase64.trim() || !certPassword.trim()) {
      toast.error(
        "Selecione o arquivo .pfx/.p12 e informe a senha do certificado.",
      );
      return;
    }
    setCertSaving(true);
    try {
      const val = await validateCertificateWithFocusNfe({
        companyId,
        certBase64: certBase64.trim(),
        password: certPassword.trim(),
      });
      if (val.status !== "valid") {
        toast.error(
          val.error_message ?? "Certificado inválido ou não validado.",
        );
        return;
      }
      const fx = await focusAtualizarCertificado({
        companyId,
        removeCertificate: false,
        arquivo_certificado_base64: certBase64.trim(),
        senha_certificado: certPassword.trim(),
      });
      if (!fx.ok) {
        toast.error(fx.error);
        return;
      }
      const nextCertStatus: CertificateUploadStatus = "valid";
      const certValidadeOut = val.certificado_validade ?? "";
      const nextSetup: Record<string, unknown> = {
        ...setupRaw,
        certificate: {
          ...certSetup,
          status: nextCertStatus,
          file_name:
            certFileName || (certSetup.file_name as string | undefined),
          storage_path: undefined,
          updated_at: new Date().toISOString(),
        },
      };
      const focusPersist = stripFocusnfeSecrets({
        ...focusRaw,
        certificado_ativo: true,
        certificado_validade: certValidadeOut,
      });
      const { error: uErr } = await supabase
        .from("companies")
        .update({
          focusnfe: focusPersist as unknown as Record<string, unknown>,
          setup: nextSetup,
        })
        .eq("id", companyId);
      if (uErr) throw uErr;
      await refetchCompanies();
      resetCertForm();
      setShowCertEditor(false);
      toast.success(
        "Certificado atualizado na Focus e dados da unidade gravados.",
      );
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : "Erro ao gravar certificado.";
      toast.error(msg);
    } finally {
      setCertSaving(false);
    }
  };

  const handleRemoveCertificate = async () => {
    if (!companyId) return;
    if (!hasEmpresaFocus) {
      toast.error("Unidade sem ID Focus NFe.");
      return;
    }
    setCertSaving(true);
    try {
      const fx = await focusAtualizarCertificado({
        companyId,
        removeCertificate: true,
      });
      if (!fx.ok) {
        toast.error(fx.error);
        return;
      }
      const nextSetup: Record<string, unknown> = {
        ...setupRaw,
        certificate: {
          ...certSetup,
          status: "not_sent" as CertificateUploadStatus,
          file_name: undefined,
          storage_path: undefined,
          updated_at: new Date().toISOString(),
        },
      };
      const focusPersist = stripFocusnfeSecrets({
        ...focusRaw,
        certificado_ativo: false,
        certificado_validade: "",
      });
      const { error: uErr } = await supabase
        .from("companies")
        .update({
          focusnfe: focusPersist as unknown as Record<string, unknown>,
          setup: nextSetup,
        })
        .eq("id", companyId);
      if (uErr) throw uErr;
      await refetchCompanies();
      setRemoveCertOpen(false);
      resetCertForm();
      setShowCertEditor(false);
      toast.success("Certificado removido na Focus.");
    } catch (e: unknown) {
      const msg =
        e instanceof Error ? e.message : "Erro ao remover certificado.";
      toast.error(msg);
    } finally {
      setCertSaving(false);
    }
  };

  const handlePurgeOnboardingXml = async () => {
    if (!companyId) return;
    setPurging(true);
    try {
      const { data, error } = await supabase.rpc(
        "purge_company_onboarding_xml_expenses",
        {
          p_company_id: companyId,
        },
      );
      if (error) {
        toast.error(error.message);
        return;
      }
      const row = data as Record<string, unknown> | null;
      if (!row || row.ok !== true) {
        const msg =
          typeof row?.message === "string"
            ? row.message
            : typeof row?.error === "string"
              ? row.error
              : "Não foi possível remover as despesas.";
        toast.error(msg);
        return;
      }
      const n = Number(row.deleted_count ?? 0);
      toast.success(
        n === 0
          ? "Nenhuma despesa encontrada para esse lote de XML do onboarding."
          : `${n} despesa(s) removida(s).`,
      );
      setPurgeOpen(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erro ao executar limpeza.";
      toast.error(msg);
    } finally {
      setPurging(false);
    }
  };

  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Fiscal</CardTitle>
          <CardDescription>
            Selecione uma unidade para ver as opções fiscais.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileKey className="h-4 w-4" />
            Certificado digital (A1)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
            <p className="font-medium text-foreground">Certificado ativo</p>
            <p className="mt-1 text-muted-foreground">
              Valido até:{" "}
              {certAtivo && certValidade
                ? formatDatePt(certValidade)
                : "Sem certificado ativo ou validade ainda não registada."}
            </p>
          </div>

          <div className="space-y-4">
            {!showCertEditor && certAtivo && !certBase64.trim() ? (
              <div className="rounded-xl border bg-muted/20 px-4 py-3 text-sm">
                <p className="font-medium text-foreground">
                  Certificado já configurado
                </p>
                <p className="mt-1 text-muted-foreground">
                  Esta unidade já possui um certificado ativo na Focus.
                  {certValidade
                    ? ` Validade informada: ${formatDatePt(certValidade)}.`
                    : ""}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!hasEmpresaFocus || certSaving}
                    onClick={() => setShowCertEditor(true)}
                  >
                    Alterar certificado
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!hasEmpresaFocus || certSaving || !certAtivo}
                    onClick={() => setRemoveCertOpen(true)}
                  >
                    Remover certificado
                  </Button>
                </div>
              </div>
            ) : (
              <StepCertificateForm
                companyId={companyId}
                cert={certView}
                password={certPassword}
                onPasswordChange={setCertPassword}
                onPickFile={(f) => void handleCertFile(f)}
                lockWhenValid={false}
                onRemoveCertificate={
                  hasEmpresaFocus && certAtivo && !certSaving
                    ? () => setRemoveCertOpen(true)
                    : undefined
                }
                busy={certSaving}
              />
            )}
            <div className="flex flex-wrap gap-2">
              {(!certAtivo || showCertEditor) && (
                <Button
                  type="button"
                  disabled={
                    !hasEmpresaFocus ||
                    certSaving ||
                    !certBase64.trim() ||
                    !certPassword.trim()
                  }
                  onClick={() => void handleSaveCertificate()}
                >
                  {certSaving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />A gravar…
                    </>
                  ) : (
                    "Gravar certificado"
                  )}
                </Button>
              )}
              {showCertEditor || certBase64.trim() ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={certSaving}
                  onClick={() => {
                    resetCertForm();
                    setShowCertEditor(false);
                  }}
                >
                  Cancelar alteração
                </Button>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-muted">
        <CardHeader>
          <CardTitle className="text-base">NF-e recebidas (Focus)</CardTitle>
          <CardDescription>
            A sincronização manual que descarregava XML pela API Focus e processava lotes
            nesta app foi removida. O novo fluxo de importação será ligado separadamente.
          </CardDescription>
        </CardHeader>
      </Card>

      {!(!onboardingBatchId || purging) && (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-destructive">
              <Trash2 className="h-4 w-4" />
              Despesas do onboarding (XML)
            </CardTitle>
            <CardDescription>
              Remove todas as despesas criadas a partir do ficheiro ou ZIP de
              NF-e indicado no assistente inicial, usando o lote guardado em{" "}
              <code className="rounded bg-muted px-1 text-xs">
                setup.xml_zip_import.job_batch_id
              </code>
              . Não reverte movimentações de stock já registadas por essas
              despesas.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 dark:text-amber-50">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                Ação irreversível. Use apenas se quiser refazer a importação de
                compras do passo XML do setup.
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              Lote no onboarding:{" "}
              <span className="font-mono text-xs">
                {onboardingBatchId
                  ? onboardingBatchId
                  : "— (não guardado ou já limpo)"}
              </span>
            </p>
            <Button
              type="button"
              variant="destructive"
              onClick={() => setPurgeOpen(true)}
            >
              Remover despesas do XML do onboarding
            </Button>
          </CardContent>
        </Card>
      )}

      <Dialog open={removeCertOpen} onOpenChange={setRemoveCertOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover certificado na Focus?</DialogTitle>
            <DialogDescription>
              A emissão de documentos fiscais pela API Focus deixará de usar
              este certificado até enviar outro.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRemoveCertOpen(false)}
              disabled={certSaving}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={certSaving}
              onClick={() => void handleRemoveCertificate()}
            >
              {certSaving ? "A remover…" : "Confirmar remoção"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={purgeOpen} onOpenChange={setPurgeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover despesas do onboarding?</DialogTitle>
            <DialogDescription>
              Serão apagadas as despesas desta unidade associadas ao lote de
              importação XML gravado no onboarding. Itens, anexos em cascata e
              pendências de revisão ligadas a essas despesas serão tratados pela
              base de dados; verifique stock manualmente se necessário.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPurgeOpen(false)}
              disabled={purging}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={purging}
              onClick={() => void handlePurgeOnboardingXml()}
            >
              {purging ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />A remover…
                </>
              ) : (
                "Confirmar exclusão"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
