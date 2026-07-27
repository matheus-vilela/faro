import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CertificateUploadFields } from "@/components/unit-setup/steps/CertificateUploadFields";
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
import { Loader2 } from "lucide-react";
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

type FiscalCertificateConfigSectionProps = {
  /** Layout compacto para o Sheet de Integrações. */
  compact?: boolean;
};

export function FiscalCertificateConfigSection({
  compact = false,
}: FiscalCertificateConfigSectionProps) {
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
        "A unidade ainda não está vinculada à Focus NFe. Conclua o setup inicial ou crie a empresa na Focus.",
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
      const nextSetup: Record<string, unknown> = {
        ...setupRaw,
        certificate: {
          ...certSetup,
          status: "valid" as CertificateUploadStatus,
          file_name:
            certFileName || (certSetup.file_name as string | undefined),
          storage_path: undefined,
          updated_at: new Date().toISOString(),
        },
      };
      const focusPersist = stripFocusnfeSecrets({
        ...focusRaw,
        certificado_ativo: true,
        certificado_validade: val.certificado_validade ?? "",
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
      toast.success("Certificado atualizado na Focus.");
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

  if (!companyId) {
    return (
      <p className="text-sm text-muted-foreground">
        Selecione uma unidade para configurar o certificado.
      </p>
    );
  }

  return (
    <>
      <div className={compact ? "space-y-4" : "space-y-4"}>
        {!hasEmpresaFocus ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-950 dark:text-amber-50">
            Esta unidade ainda não possui empresa cadastrada na Focus NFe.
            Conclua o assistente de setup ou entre em contato com o suporte.
          </div>
        ) : null}

        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm">
          <p className="font-medium text-foreground">Certificado ativo</p>
          <p className="mt-1 text-muted-foreground">
            Válido até:{" "}
            {certAtivo && certValidade
              ? formatDatePt(certValidade)
              : "Sem certificado ativo ou validade ainda não registrada."}
          </p>
        </div>

        {!showCertEditor && certAtivo && !certBase64.trim() ? (
          <div className="rounded-xl border bg-muted/20 px-4 py-3 text-sm">
            <p className="font-medium text-foreground">
              Certificado já configurado
            </p>
            <p className="mt-1 text-muted-foreground">
              Esta unidade possui certificado A1 na Focus.
              {certValidade
                ? ` Validade: ${formatDatePt(certValidade)}.`
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
          <CertificateUploadFields
            cert={certView}
            password={certPassword}
            onPasswordChange={setCertPassword}
            onPickFile={(f) => void handleCertFile(f)}
            lockWhenValid={false}
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
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  A gravar…
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
              Cancelar
            </Button>
          ) : null}
        </div>
      </div>

      <Dialog open={removeCertOpen} onOpenChange={setRemoveCertOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover certificado na Focus?</DialogTitle>
            <DialogDescription>
              A consulta de NF-e recebidas na SEFAZ deixará de funcionar até
              enviar outro certificado A1.
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
    </>
  );
}

export function useFiscalIntegrationStatus(): {
  active: boolean;
  hasEmpresaFocus: boolean;
  certAtivo: boolean;
  lastSyncAt: string | null;
} {
  const { currentCompany } = useCompany();
  const focusRaw = asObj(currentCompany?.focusnfe);
  const certAtivo = focusRaw.certificado_ativo === true;
  const hasEmpresa = hasFocusNfeEmpresaId(currentCompany?.focusnfe);
  const lastSyncRaw = focusRaw.nfes_recebidas_ultima_sync_at;
  const lastSyncAt =
    typeof lastSyncRaw === "string" && lastSyncRaw.trim()
      ? lastSyncRaw.trim()
      : null;
  return {
    active: hasEmpresa && certAtivo,
    hasEmpresaFocus: hasEmpresa,
    certAtivo,
    lastSyncAt,
  };
}
