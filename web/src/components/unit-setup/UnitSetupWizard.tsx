import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useCompany } from "@/contexts/CompanyContext";
import { maskCpfCnpj } from "@/lib/masks";
import {
  getNextPendingStep,
  markStepCompleted,
  markStepSkipped,
  mergeSetupPatch,
} from "@/lib/setup/setupProgress";
import { validateStep1Empresa, validateStep3FocusNfe } from "@/lib/setup/validation";
import { supabase } from "@/lib/supabase";
import { fetchAddressByCep } from "@/services/addressLookupService";
import { validateCertificateWithFocusNfe, syncFocusNfeCompanyProfile } from "@/services/focusNfeService";
import {
  buildCompletedSetup,
  buildPausedSetup,
  createCompanyFromSetupStep1,
  fetchCompanySetupRow,
  normalizeSetupMap,
  patchCompanyMaps,
} from "@/services/unitSetupService";
import { processXmlZipImport } from "@/services/xmlZipImportService";
import type {
  EmpresaMap,
  EnderecoPrincipalMap,
  FocusNfeMap,
  CompanySetupMap,
  SetupEpocState,
  SetupXmlZipImportState,
  SetupStepNumber,
} from "@/types/companySetup";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { SetupStepper } from "./SetupStepper";
import { StepAddressForm } from "./steps/StepAddressForm";
import { StepCertificateForm } from "./steps/StepCertificateForm";
import { StepCompanyForm } from "./steps/StepCompanyForm";
import { StepEpocForm } from "./steps/StepEpocForm";
import { StepFiscalForm } from "./steps/StepFiscalForm";
import { StepXmlZipForm } from "./steps/StepXmlZipForm";
import { Building2, Loader2 } from "lucide-react";

type Phase = "wizard" | "finalize_loading" | "finalize_summary";

function emptyEmpresa(): EmpresaMap {
  return {};
}

function emptyEndereco(): EnderecoPrincipalMap {
  return {};
}

function emptyFocus(): FocusNfeMap {
  return {};
}

export function UnitSetupWizard({
  resumeCompanyId,
  newUnitGroupId,
  createNewGroup,
  variant = "page",
  onExit,
}: {
  resumeCompanyId?: string;
  newUnitGroupId?: string | null;
  createNewGroup: boolean;
  /** `modal`: layout compacto e saída via `onExit` em vez de rotas. */
  variant?: "page" | "modal";
  /** Quando definido, substitui `navigate('/app')` (pausa, resumo, etc.). */
  onExit?: () => void;
}) {
  const { user } = useAuth();
  const { refetchCompanies } = useCompany();
  const navigate = useNavigate();
  const isModal = variant === "modal";
  const exitApp = () => {
    if (onExit) onExit();
    else navigate("/app", { replace: true });
  };

  const [companyId, setCompanyId] = useState<string | null>(
    resumeCompanyId ?? null,
  );
  const [groupName, setGroupName] = useState("");
  const [activeStep, setActiveStep] = useState(1);
  const [phase, setPhase] = useState<Phase>("wizard");

  const [empresa, setEmpresa] = useState<EmpresaMap>(emptyEmpresa);
  const [endereco, setEndereco] = useState<EnderecoPrincipalMap>(emptyEndereco);
  const [focusnfe, setFocusnfe] = useState<FocusNfeMap>(emptyFocus);
  const [setup, setSetup] = useState<CompanySetupMap>(() =>
    normalizeSetupMap({}),
  );

  const [certPassword, setCertPassword] = useState("");
  const [cepLoading, setCepLoading] = useState(false);
  const [cepError, setCepError] = useState<string | null>(null);
  const [xmlBusy, setXmlBusy] = useState(false);
  const [certBusy, setCertBusy] = useState(false);

  const [loading, setLoading] = useState(!!resumeCompanyId);
  const [saving, setSaving] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!resumeCompanyId) return;
    setLoading(true);
    const row = await fetchCompanySetupRow(resumeCompanyId);
    setLoading(false);
    if ("error" in row) {
      toast.error(row.error);
      return;
    }
    const c = row.company;
    setCompanyId(c.id);
    setEmpresa((c.empresa ?? {}) as EmpresaMap);
    setEndereco((c.endereco_principal ?? {}) as EnderecoPrincipalMap);
    setFocusnfe((c.focusnfe ?? {}) as FocusNfeMap);
    const su = normalizeSetupMap(c.setup ?? {});
    setSetup(su);
    setActiveStep(
      Math.min(6, Math.max(1, su.current_step ?? getNextPendingStep(su))),
    );
  }, [resumeCompanyId]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const handleCepBlur = useCallback(async () => {
    const digits = (endereco.cep ?? "").replace(/\D/g, "");
    if (digits.length !== 8) return;
    setCepLoading(true);
    setCepError(null);
    const res = await fetchAddressByCep(endereco.cep ?? "");
    setCepLoading(false);
    if (!res.ok) {
      setCepError(res.error);
      return;
    }
    setEndereco((prev) => ({ ...prev, ...res.data }));
  }, [endereco.cep]);

  const handlePause = async () => {
    if (!user) return;
    setSaving(true);
    try {
      if (companyId) {
        const paused = buildPausedSetup(setup);
        await patchCompanyMaps(companyId, {
          empresa,
          endereco_principal: endereco,
          focusnfe,
          setup: paused,
          name: (empresa.nome_fantasia ?? "").trim() || empresa.nome_razao_social?.trim() || undefined,
          document: (empresa.cnpj_cpf ?? "").replace(/\D/g, "") || undefined,
          email: (empresa.email ?? "").trim() || null,
          phone: (empresa.telefone ?? "").replace(/\D/g, "") || null,
        });
        setSetup(paused);
        await refetchCompanies();
      }
      toast.message("Setup pausado. Você pode retomar pelo início.");
      exitApp();
    } finally {
      setSaving(false);
    }
  };

  const runStep1Create = async (): Promise<boolean> => {
    if (!user) return false;
    const err = validateStep1Empresa(empresa);
    if (err) {
      setStepError(err);
      return false;
    }
    if (createNewGroup && !groupName.trim()) {
      setStepError("Informe o nome do grupo.");
      return false;
    }
    if (!createNewGroup && !newUnitGroupId) {
      setStepError("Grupo inválido.");
      return false;
    }
    setSaving(true);
    const created = await createCompanyFromSetupStep1(
      createNewGroup
        ? {
            mode: "new_group",
            ownerUserId: user.id,
            groupName: groupName.trim(),
            empresa,
          }
        : {
            mode: "existing_group",
            ownerUserId: user.id,
            groupId: newUnitGroupId!,
            empresa,
          },
    );
    setSaving(false);
    if ("error" in created) {
      toast.error(created.error);
      return false;
    }
    setCompanyId(created.companyId);
    await refetchCompanies();
    if (!isModal) {
      navigate(`/empresas/unidade/setup/${created.companyId}`, {
        replace: true,
      });
    }
    toast.success("Unidade criada. Continue o cadastro.");
    return true;
  };

  const runStep1Patch = async (): Promise<boolean> => {
    const err = validateStep1Empresa(empresa);
    if (err) {
      setStepError(err);
      return false;
    }
    if (!companyId) return false;
    setSaving(true);
    const docDigits = (empresa.cnpj_cpf ?? "").replace(/\D/g, "");
    const phoneDigits = (empresa.telefone ?? "").replace(/\D/g, "");
    const displayName =
      (empresa.nome_fantasia ?? "").trim() || (empresa.nome_razao_social ?? "").trim();
    const nextSetup = markStepCompleted(setup, 1);
    const res = await patchCompanyMaps(companyId, {
      empresa: { ...empresa, cnpj_cpf: docDigits, telefone: phoneDigits },
      setup: {
        ...nextSetup,
        current_step: 2,
        updated_at: new Date().toISOString(),
      },
      name: displayName,
      document: docDigits,
      email: (empresa.email ?? "").trim() || null,
      phone: phoneDigits || null,
    });
    setSaving(false);
    if (res.error) {
      toast.error(res.error);
      return false;
    }
    setSetup(nextSetup);
    return true;
  };

  const handleNext = async () => {
    setStepError(null);

    if (activeStep === 1) {
      if (!companyId) {
        const ok = await runStep1Create();
        if (ok) setActiveStep(2);
        return;
      }
      const ok = await runStep1Patch();
      if (ok) setActiveStep(2);
      return;
    }

    if (!companyId) {
      toast.error("Conclua o passo 1 antes de avançar.");
      return;
    }

    if (activeStep === 2) {
      setSaving(true);
      let nextSetup = markStepCompleted(setup, 2);
      nextSetup = mergeSetupPatch(nextSetup, { current_step: 3 });
      const res = await patchCompanyMaps(companyId, {
        endereco_principal: endereco,
        setup: nextSetup,
      });
      setSaving(false);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      setSetup(nextSetup);
      setActiveStep(3);
      return;
    }

    if (activeStep === 3) {
      const v = validateStep3FocusNfe(focusnfe);
      if (v) {
        setStepError(v);
        return;
      }
      setSaving(true);
      let nextSetup = markStepCompleted(setup, 3);
      nextSetup = mergeSetupPatch(nextSetup, { current_step: 4 });
      const res = await patchCompanyMaps(companyId, {
        focusnfe,
        setup: nextSetup,
      });
      setSaving(false);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      setSetup(nextSetup);
      setActiveStep(4);
      return;
    }

    if (activeStep === 4) {
      let nextFocus = { ...focusnfe };
      const cert = setup.certificate;
      let certOut = cert;
      if (
        cert?.storage_path &&
        certPassword &&
        cert.status !== "invalid"
      ) {
        setCertBusy(true);
        const val = await validateCertificateWithFocusNfe({
          companyId,
          storagePath: cert.storage_path,
          password: certPassword,
        });
        setCertBusy(false);
        nextFocus = {
          ...nextFocus,
          certificado_ativo: val.status === "valid",
          certificado_validade: val.certificado_validade,
        };
        setFocusnfe(nextFocus);
        certOut = {
          ...cert,
          status: val.status,
          updated_at: new Date().toISOString(),
        };
        setSetup((s) => ({
          ...s,
          certificate: certOut,
        }));
      }
      setSaving(true);
      let nextSetup = markStepCompleted(setup, 4);
      nextSetup = mergeSetupPatch(nextSetup, {
        current_step: 5,
        certificate: certOut,
      });
      const res = await patchCompanyMaps(companyId, {
        focusnfe: nextFocus,
        setup: nextSetup,
      });
      setSaving(false);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      setSetup(nextSetup);
      setActiveStep(5);
      return;
    }

    if (activeStep === 5) {
      setSaving(true);
      let nextSetup = markStepCompleted(setup, 5);
      nextSetup = mergeSetupPatch(nextSetup, { current_step: 6 });
      const res = await patchCompanyMaps(companyId, {
        setup: nextSetup,
      });
      setSaving(false);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      setSetup(nextSetup);
      setActiveStep(6);
      return;
    }

    if (activeStep === 6) {
      const ep = setup.epoc ?? { mode: "undecided" as const };
      if (ep.mode === "undecided") {
        setStepError("Indique se haverá integração EPOC.");
        return;
      }
      setSaving(true);
      let nextSetup: CompanySetupMap;
      if (ep.mode === "no") {
        nextSetup = markStepSkipped(
          mergeSetupPatch(setup, { epoc: { ...ep, mode: "no" } }),
          6,
        );
      } else {
        nextSetup = markStepCompleted(mergeSetupPatch(setup, { epoc: ep }), 6);
        if (ep.mode === "credentials" && ep.username?.trim()) {
          await supabase.from("company_integrations").upsert(
            {
              company_id: companyId,
              provider: "epoc",
              enabled: true,
              settings: {
                username: ep.username,
                password: ep.password,
                base_url: ep.base_url,
                codigo_filial: ep.codigo_filial,
                ambiente: "producao",
              },
            },
            { onConflict: "company_id,provider" },
          );
        }
      }
      nextSetup = mergeSetupPatch(nextSetup, { current_step: 7 });
      await patchCompanyMaps(companyId, {
        setup: nextSetup,
        focusnfe,
      });
      setSetup(nextSetup);
      setSaving(false);
      setPhase("finalize_loading");
      await finalizeRun(nextSetup, focusnfe);
    }
  };

  async function finalizeRun(
    lastSetup: CompanySetupMap,
    focus: FocusNfeMap,
  ) {
    if (!companyId) return;
    await syncFocusNfeCompanyProfile(companyId, focus);
    const pending = getNextPendingStep(lastSetup);
    const allDone = pending > 6;
    const completed = buildCompletedSetup(lastSetup, {
      allApplicableDone: allDone,
    });
    await patchCompanyMaps(companyId, { setup: completed });
    setSetup(completed);
    await refetchCompanies();
    setPhase("finalize_summary");
  }

  const handleBack = () => {
    if (activeStep <= 1) return;
    setActiveStep((s) => s - 1);
  };

  const goToStep = useCallback((step: SetupStepNumber) => {
    if (step < 1 || step > 6) return;
    if (step > 1 && !companyId) return;
    setStepError(null);
    setActiveStep(step);
  }, [companyId]);

  const handleCertFile = async (file: File) => {
    if (!companyId) return;
    setCertBusy(true);
    const path = `${companyId}/cert/${Date.now()}_${file.name}`;
    const { error } = await supabase.storage
      .from("company-setup")
      .upload(path, file, { upsert: true });
    setCertBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const certState = {
      status: "uploaded" as const,
      storage_path: path,
      file_name: file.name,
      updated_at: new Date().toISOString(),
    };
    setSetup((s) =>
      mergeSetupPatch(s, {
        certificate: certState,
      }),
    );
    await patchCompanyMaps(companyId, {
      setup: mergeSetupPatch(setup, { certificate: certState }),
    });
    toast.success("Certificado enviado.");
  };

  const handleXmlFile = async (file: File) => {
    if (!companyId) return;
    setXmlBusy(true);
    const path = `${companyId}/imports/xml/${Date.now()}_${file.name}`;
    const { error } = await supabase.storage
      .from("company-setup")
      .upload(path, file, { upsert: true });
    if (error) {
      setXmlBusy(false);
      toast.error(error.message);
      return;
    }
    let xmlState: SetupXmlZipImportState = {
      phase: "uploading",
      storage_path: path,
      file_name: file.name,
      file_log: [],
    };
    setSetup((s) => mergeSetupPatch(s, { xml_zip_import: xmlState }));
    await processXmlZipImport(companyId, file, {
      onPhase: (ph) => {
        xmlState = { ...xmlState, phase: ph };
        setSetup((s) =>
          mergeSetupPatch(s, { xml_zip_import: { ...xmlState, phase: ph } }),
        );
      },
      onLog: (entries) => {
        xmlState = { ...xmlState, file_log: entries };
        setSetup((s) =>
          mergeSetupPatch(s, {
            xml_zip_import: { ...xmlState, file_log: entries },
          }),
        );
      },
    });
    xmlState = {
      ...xmlState,
      phase: "done",
      updated_at: new Date().toISOString(),
    };
    setSetup((s) => mergeSetupPatch(s, { xml_zip_import: xmlState }));
    await patchCompanyMaps(companyId, {
      setup: mergeSetupPatch(setup, { xml_zip_import: xmlState }),
    });
    setXmlBusy(false);
    toast.message("Importação simulada concluída.");
  };

  const handleEpocExcel = async (file: File) => {
    if (!companyId) return;
    const path = `${companyId}/imports/epoc/${Date.now()}_${file.name}`;
    const { error } = await supabase.storage
      .from("company-setup")
      .upload(path, file, { upsert: true });
    if (error) {
      toast.error(error.message);
      return;
    }
    const ep: SetupEpocState = {
      ...(setup.epoc ?? { mode: "excel" }),
      mode: "excel",
      excel_storage_path: path,
      updated_at: new Date().toISOString(),
    };
    setSetup((s) => mergeSetupPatch(s, { epoc: ep }));
    await patchCompanyMaps(companyId, {
      setup: mergeSetupPatch(setup, { epoc: ep }),
    });
    toast.success("Planilha enviada.");
  };

  const loadingMinH = isModal ? "min-h-[200px]" : "min-h-[50vh]";

  if (loading) {
    return (
      <div
        className={`flex ${loadingMinH} flex-col items-center justify-center gap-3`}
      >
        <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Carregando assistente…</p>
      </div>
    );
  }

  if (phase === "finalize_loading") {
    return (
      <div className={`flex ${loadingMinH} flex-col items-center justify-center gap-4`}>
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="text-center text-lg font-medium">
          Finalizando configuração…
        </p>
        <p className="text-sm text-muted-foreground">
          Sincronizando dados e concluindo rotinas pendentes.
        </p>
      </div>
    );
  }

  if (phase === "finalize_summary") {
    const summaryInner = (
      <>
        <PageHeader
          title="Configuração concluída"
          description="Resumo do que foi registrado nesta unidade."
          icon={Building2}
          className={isModal ? "pb-2" : undefined}
        />
        <div className="space-y-4 rounded-xl border bg-card p-6 text-sm">
          <div>
            <p className="font-medium">Empresa</p>
            <p className="text-muted-foreground">
              {empresa.nome_fantasia} — {maskCpfCnpj(empresa.cnpj_cpf ?? "")}
            </p>
            <p className="text-muted-foreground">{empresa.email}</p>
          </div>
          <div>
            <p className="font-medium">Endereço</p>
            <p className="text-muted-foreground">
              {[endereco.logradouro, endereco.numero, endereco.bairro]
                .filter(Boolean)
                .join(", ")}
            </p>
            <p className="text-muted-foreground">
              {endereco.municipio} / {endereco.uf} — CEP {endereco.cep}
            </p>
          </div>
          <div>
            <p className="font-medium">Fiscal</p>
            <p className="text-muted-foreground">
              Modelo: {focusnfe.modelo ?? "—"}
            </p>
          </div>
          <div>
            <p className="font-medium">Certificado</p>
            <p className="text-muted-foreground">
              {setup.certificate?.status === "valid"
                ? `Válido até ${focusnfe.certificado_validade ?? "—"}`
                : setup.certificate?.status ?? "não enviado"}
            </p>
          </div>
          <div>
            <p className="font-medium">Importações</p>
            <p className="text-muted-foreground">
              XML/ZIP: {setup.xml_zip_import?.phase ?? "—"}
            </p>
            <p className="text-muted-foreground">
              EPOC:{" "}
              {setup.epoc?.mode === "no"
                ? "Sem integração"
                : setup.epoc?.mode ?? "—"}
            </p>
          </div>
          <p className="pt-2 font-semibold">
            Progresso final: {setup.progress_percent?.toFixed(0) ?? 0}%
          </p>
        </div>
        <Button onClick={() => exitApp()}>Ir para o início</Button>
      </>
    );
    return isModal ? (
      <div className="space-y-6">{summaryInner}</div>
    ) : (
      <PageShell className="max-w-2xl">{summaryInner}</PageShell>
    );
  }

  const wizardBody = (
    <>
      <PageHeader
        title="Configurar unidade"
        description="Assistente em etapas. O passo 1 cria a unidade; os demais podem ser concluídos depois."
        icon={Building2}
        className={isModal ? "pb-2" : undefined}
      />

      <SetupStepper
        activeStep={activeStep}
        setup={setup}
        companyId={companyId}
        onStepClick={goToStep}
      />

      {stepError ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {stepError}
        </p>
      ) : null}

      <div className="rounded-xl border bg-card p-6 shadow-sm">
        {activeStep === 1 ? (
          <StepCompanyForm
            groupName={groupName}
            onGroupNameChange={setGroupName}
            showGroupName={createNewGroup && !resumeCompanyId}
            empresa={{
              ...empresa,
              cnpj_cpf: empresa.cnpj_cpf ?? "",
              telefone: empresa.telefone ?? "",
            }}
            onEmpresaChange={(patch) =>
              setEmpresa((prev) => ({ ...prev, ...patch }))
            }
          />
        ) : null}
        {activeStep === 2 ? (
          <StepAddressForm
            endereco={endereco}
            onEnderecoChange={(patch) =>
              setEndereco((prev) => ({ ...prev, ...patch }))
            }
            cepLoading={cepLoading}
            cepError={cepError}
            onCepBlur={() => void handleCepBlur()}
          />
        ) : null}
        {activeStep === 3 ? (
          <StepFiscalForm focusnfe={focusnfe} onChange={(p) => setFocusnfe((x) => ({ ...x, ...p }))} />
        ) : null}
        {activeStep === 4 ? (
          <StepCertificateForm
            companyId={companyId}
            cert={setup.certificate}
            password={certPassword}
            onPasswordChange={setCertPassword}
            onPickFile={(f) => void handleCertFile(f)}
            busy={certBusy}
          />
        ) : null}
        {activeStep === 5 ? (
          <StepXmlZipForm
            state={setup.xml_zip_import}
            onPickFile={(f) => void handleXmlFile(f)}
            busy={xmlBusy}
          />
        ) : null}
        {activeStep === 6 ? (
          <StepEpocForm
            epoc={setup.epoc}
            onEpocChange={(patch) =>
              setSetup((s) =>
                mergeSetupPatch(s, {
                  epoc: { ...(s.epoc ?? { mode: "undecided" }), ...patch },
                }),
              )
            }
            onPickExcel={(f) => void handleEpocExcel(f)}
          />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => void handlePause()}
          disabled={saving}
        >
          Pausar setup
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={handleBack}
            disabled={activeStep <= 1 || saving}
          >
            Voltar
          </Button>
          <Button
            type="button"
            onClick={() => void handleNext()}
            disabled={saving || certBusy}
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Salvando…
              </>
            ) : activeStep === 6 ? (
              "Concluir"
            ) : (
              "Próximo"
            )}
          </Button>
        </div>
      </div>
    </>
  );

  return isModal ? (
    <div className="space-y-6">{wizardBody}</div>
  ) : (
    <PageShell className="max-w-3xl space-y-8">{wizardBody}</PageShell>
  );
}
