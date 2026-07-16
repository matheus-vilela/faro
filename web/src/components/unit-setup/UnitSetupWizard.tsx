import logoDark from "@/assets/logos/faro_logo_darkmode_transp.png";
import logoLight from "@/assets/logos/faro_logo_light_transparent.png";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { useCompany } from "@/contexts/CompanyContext";
import { useUnitSetupModal } from "@/contexts/UnitSetupModalContext";
import {
  applyFocusCnpjConsulta,
  buildFocusCnpjConsultaRecord,
  clearFocusCnpjFilledFields,
  resolveFocusCnpjLockForResume,
} from "@/lib/focusCnpjApply";
import { stripFocusnfeSecrets } from "@/lib/focusNfeSanitize";
import { isValidCnpj } from "@/lib/cnpj";
import { mergeOnboardingPdv } from "@/lib/onboardingPdvDefaults";
import { maskCpfCnpj, unmask } from "@/lib/masks";
import {
  getNextPendingStep,
  markStepSkipped,
  mergeSetupPatch,
  TOTAL_STEPS,
} from "@/lib/setup/setupProgress";
import { shouldValidateEpocBeforeStep3Complete } from "@/lib/setup/epocStep3ValidationGate";
import {
  buildNotificationPayload,
  getStep4WhatsappState,
  getStep6EpocState,
  isFiscalStepAdvanceAllowed,
  isPdvStepAdvanceAllowed,
  isWhatsappStepAdvanceAllowed,
  isStep1EmpresaComplete,
  isStep2EnderecoComplete,
  isStep3CertificatePayloadComplete,
  isStep4CertificateComplete,
  pdvOptionToMode,
  resolvePdvOption,
  validateStep1Empresa,
} from "@/lib/setup/validation";
import { formatNormalizedForDisplay } from "@/lib/whatsappPhone";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { invokeValidateEpocLogin } from "@/services/epocValidateLoginService";
import { triggerEpocCsvSyncInBackground } from "@/services/epocSyncCsvService";
import {
  focusAtualizarCertificado,
  hasFocusNfeEmpresaId,
} from "@/services/focusAtualizarCertificadoService";
import { consultarCnpjNaFocus } from "@/services/focusConsultaCnpjService";
import {
  buildFocusCriaEmpresaBody,
  fileToPureBase64,
  focusCriaEmpresa,
  parseFocusCertificadoValidoAteFromResponse,
  parseFocusCriaEmpresaIdFromResponse,
} from "@/services/focusCriaEmpresaService";
import {
  syncFocusNfeCompanyProfile,
  validateCertificateWithFocusNfe,
} from "@/services/focusNfeService";
import {
  createSetupCertificateDelegationLink,
  getActiveSetupCertificateDelegationLink,
} from "@/services/setupCertificateDelegationService";
import {
  buildCompletedSetup,
  buildPausedSetup,
  createCompanyFromSetupStep1,
  fetchCompanySetupRow,
  normalizeSetupMap,
  patchCompanyMaps,
} from "@/services/unitSetupService";
import {
  NOTIFICATION_RULE_LABELS,
  parseCompanyNotification,
  type CompanyNotificationEntry,
  type CompanyNotificationRule,
} from "@/types/companyNotification";
import {
  mergeEpocSettingsForUpsert,
  parseEpocSettings,
  type EpocIntegrationSettings,
} from "@/types/companyIntegration";
import type {
  CertificateFiscalMode,
  CompanySetupMap,
  EmpresaMap,
  EnderecoPrincipalMap,
  FocusNfeMap,
  PdvSalesOption,
  SetupCertificateState,
  SetupEpocState,
  SetupStepNumber,
} from "@/types/companySetup";
import { Building2, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  SetupStepper,
  wizardPageTitle,
  wizardStepCount,
  wizardStepHint,
  wizardStepLabel,
} from "./SetupStepper";
import { StepCertificateForm } from "./steps/StepCertificateForm";
import { StepCompanyForm } from "./steps/StepCompanyForm";
import { StepGroupForm } from "./steps/StepGroupForm";
import { StepPdvForm } from "./steps/StepPdvForm";
import { StepWhatsappForm } from "./steps/StepWhatsappForm";

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

function upsertStep(
  list: number[],
  step: SetupStepNumber,
  include: boolean,
): number[] {
  const s = new Set(list);
  if (include) s.add(step);
  else s.delete(step);
  return [...s].sort((a, b) => a - b);
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
  onExit?: (payload?: { companyId?: string; completed?: boolean }) => void;
}) {
  const { user } = useAuth();
  const { refetchCompanies } = useCompany();
  const { requestLeaveConfirm } = useUnitSetupModal();
  const { resolvedTheme } = useTheme();
  const navigate = useNavigate();
  const isModal = variant === "modal";
  const exitApp = (payload?: { companyId?: string; completed?: boolean }) => {
    if (onExit) onExit(payload);
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
  const [focusConsultaRecord, setFocusConsultaRecord] = useState<
    Record<string, unknown>
  >({});
  const [setup, setSetup] = useState<CompanySetupMap>(() =>
    normalizeSetupMap({}),
  );

  const [certPassword, setCertPassword] = useState("");
  /** Base64 do A1 só em memória — não vai para `companies.focusnfe`. */
  const [certFileBase64, setCertFileBase64] = useState("");
  const [certBusy, setCertBusy] = useState(false);
  const [cnpjValidating, setCnpjValidating] = useState(false);
  const [linkGenerating, setLinkGenerating] = useState(false);
  const [delegationLinkUrl, setDelegationLinkUrl] = useState<string | null>(
    null,
  );
  const [linkCopied, setLinkCopied] = useState(false);

  const [loading, setLoading] = useState(!!resumeCompanyId);
  const [saving, setSaving] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
  const [epocValidateError, setEpocValidateError] = useState<{
    message: string;
    errorCode: string;
  } | null>(null);
  const [companyNotification, setCompanyNotification] = useState<
    CompanyNotificationEntry[]
  >([]);
  const [whatsappPhoneDigits, setWhatsappPhoneDigits] = useState("");
  const [whatsappRules, setWhatsappRules] = useState<CompanyNotificationRule[]>(
    [],
  );

  /** Passo extra só ao criar um novo grupo (não ao retomar). */
  const includeGroupStep = createNewGroup && !resumeCompanyId;
  const empresaWizardStep = includeGroupStep ? 2 : 1;
  const certWizardStep = includeGroupStep ? 3 : 2;
  const pdvWizardStep = includeGroupStep ? 4 : 3;
  const whatsappWizardStep = includeGroupStep ? 5 : 4;
  const totalWizardSteps = wizardStepCount(includeGroupStep);
  const cnpjValidated =
    !!setup.focus_cnpj_lock?.validated_cnpj_digits &&
    setup.focus_cnpj_lock.validated_cnpj_digits ===
      unmask(empresa.cnpj_cpf ?? "");

  /** Unidade na Faro e etapa pós-certificado: não reabrir empresa e certificado. */
  const lockStepsOneToTwo = !!companyId && (setup.current_step ?? 1) >= 3;

  const load = useCallback(async () => {
    if (!resumeCompanyId) return;
    setLoading(true);
    const row = await fetchCompanySetupRow(resumeCompanyId);
    setLoading(false);
    if ("error" in row) {
      toast.error(row.error);
      return;
    }
    const c = row.company as typeof row.company & {
      focus_cnpj_consulta?: Record<string, unknown> | null;
    };
    setCompanyId(c.id);
    setEmpresa((c.empresa ?? {}) as EmpresaMap);
    setEndereco((c.endereco_principal ?? {}) as EnderecoPrincipalMap);
    setFocusnfe(stripFocusnfeSecrets((c.focusnfe ?? {}) as FocusNfeMap));
    setCertFileBase64("");
    setCertPassword("");
    const consultaRec =
      c.focus_cnpj_consulta && typeof c.focus_cnpj_consulta === "object"
        ? (c.focus_cnpj_consulta as Record<string, unknown>)
        : {};
    setFocusConsultaRecord(consultaRec);
    let su = normalizeSetupMap(c.setup ?? {});

    const empresaRow = (c.empresa ?? {}) as EmpresaMap;
    const docFromRow =
      String(empresaRow.cnpj_cpf ?? "")
        .replace(/\D/g, "")
        .slice(0, 14) ||
      String(c.document ?? "")
        .replace(/\D/g, "")
        .slice(0, 14);
    const resolvedLock = resolveFocusCnpjLockForResume(
      su.focus_cnpj_lock,
      consultaRec,
      docFromRow,
    );
    su = mergeSetupPatch(su, { focus_cnpj_lock: resolvedLock });

    const { data: integRow } = await supabase
      .from("company_integrations")
      .select("*")
      .eq("company_id", resumeCompanyId)
      .eq("provider", "epoc")
      .maybeSingle();

    if (integRow) {
      const pdvOption = resolvePdvOption(su.epoc);
      if (pdvOption === "epoc" || pdvOption === "undecided") {
        const s = parseEpocSettings(
          (integRow.settings ?? {}) as Record<string, unknown>,
        );
        su = mergeSetupPatch(su, {
          epoc: {
            mode: "credentials",
            pdv_option: "epoc",
            enabled: integRow.enabled,
            username: s.username,
            password: "",
            base_url: s.base_url ?? "",
            codigo_filial: s.codigo_filial ?? "",
            ambiente: s.ambiente ?? "producao",
            password_on_server: !!(s.password && s.password.length > 0),
          },
        });
      }
    }

    setSetup(su);
    const notification = parseCompanyNotification(
      (c as { notification?: unknown }).notification,
    );
    setCompanyNotification(notification);
    if (notification[0]?.number) {
      setWhatsappPhoneDigits(notification[0].number);
      setWhatsappRules(notification[0].rules);
    } else {
      const phonePrefill = (
        empresaRow.telefone ??
        c.phone ??
        ""
      ).replace(/\D/g, "");
      setWhatsappPhoneDigits(phonePrefill);
      setWhatsappRules([]);
    }
    const setupStep = Math.min(
      4,
      Math.max(1, su.current_step ?? getNextPendingStep(su)),
    );
    setActiveStep(
      includeGroupStep ? Math.min(5, setupStep + 1) : setupStep,
    );
  }, [resumeCompanyId, includeGroupStep]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  useEffect(() => {
    if (activeStep !== whatsappWizardStep) return;
    if (whatsappPhoneDigits.trim()) return;
    if (companyNotification[0]?.number) return;
    const fromEmpresa = (empresa.telefone ?? "").replace(/\D/g, "");
    if (fromEmpresa) setWhatsappPhoneDigits(fromEmpresa);
  }, [
    activeStep,
    whatsappWizardStep,
    empresa.telefone,
    whatsappPhoneDigits,
    companyNotification,
  ]);

  useEffect(() => {
    if (!companyId) return;
    if (setup.certificate?.mode !== "delegate_link") return;
    void getActiveSetupCertificateDelegationLink(companyId).then((res) => {
      if (res.ok) setDelegationLinkUrl(res.url);
    });
  }, [companyId, setup.certificate?.mode, setup.certificate?.delegation_link_id]);

  const syncCompletionState = useCallback(
    (
      base: CompanySetupMap,
      overrides?: Partial<CompanySetupMap>,
      certSecrets?: { certBase64: string; certPassword: string },
      notificationOverride?: CompanyNotificationEntry[],
    ): CompanySetupMap => {
      const merged = mergeSetupPatch(base, overrides ?? {});
      const s1 = isStep1EmpresaComplete(empresa, {
        requireFocusCnpjValidation: true,
        focusCnpjLock: merged.focus_cnpj_lock,
      });
      const sec = certSecrets ?? {
        certBase64: certFileBase64,
        certPassword,
      };
      const certMode: CertificateFiscalMode =
        merged.certificate?.mode ?? "undecided";
      let s2cert = false;
      let s2skipped = false;
      if (certMode === "skip") {
        s2skipped = true;
      } else if (certMode === "delegate_link") {
        s2cert = merged.certificate?.status === "valid";
      } else {
        s2cert = companyId
          ? isStep4CertificateComplete(merged.certificate)
          : isStep3CertificatePayloadComplete(merged.certificate, sec);
      }
      const s3ep = getStep6EpocState(merged.epoc);
      const s4wa = getStep4WhatsappState(
        notificationOverride ?? companyNotification,
      );

      let completed = merged.completed_steps ?? [];
      let skipped = merged.skipped_steps ?? [];
      completed = upsertStep(completed, 1, s1);
      completed = upsertStep(completed, 2, s2cert);
      completed = upsertStep(completed, 3, s3ep.completed);
      completed = upsertStep(completed, 4, s4wa.completed);
      skipped = upsertStep(skipped, 2, s2skipped);
      skipped = upsertStep(skipped, 3, s3ep.skipped);
      skipped = upsertStep(skipped, 4, s4wa.skipped);

      return mergeSetupPatch(merged, {
        completed_steps: completed,
        skipped_steps: skipped,
      });
    },
    [companyId, empresa, certFileBase64, certPassword, companyNotification],
  );

  const applyEmpresaPatch = useCallback(
    (patch: Partial<EmpresaMap>) => {
      const nextDigits =
        patch.cnpj_cpf !== undefined
          ? String(patch.cnpj_cpf).replace(/\D/g, "").slice(0, 14)
          : unmask(empresa.cnpj_cpf ?? "");
      const validated = setup.focus_cnpj_lock?.validated_cnpj_digits;
      if (
        patch.cnpj_cpf !== undefined &&
        validated &&
        validated !== nextDigits
      ) {
        const cleared = clearFocusCnpjFilledFields(
          empresa,
          endereco,
          setup.focus_cnpj_lock,
        );
        setEmpresa({ ...cleared.empresa, cnpj_cpf: nextDigits });
        setEndereco(cleared.endereco);
        setSetup((s) => mergeSetupPatch(s, { focus_cnpj_lock: undefined }));
        setFocusConsultaRecord({});
        return;
      }
      setEmpresa((prev) => ({ ...prev, ...patch }));
    },
    [empresa, endereco, setup.focus_cnpj_lock],
  );

  const handleValidarCnpj = useCallback(async (): Promise<boolean> => {
    const digits = unmask(empresa.cnpj_cpf ?? "");
    if (digits.length !== 14) {
      toast.error("Informe o CNPJ completo (14 dígitos) antes de validar.");
      return false;
    }
    setCnpjValidating(true);
    try {
      const res = await consultarCnpjNaFocus(digits);
      if (!res.ok) {
        toast.error(res.error);
        return false;
      }
      const applied = applyFocusCnpjConsulta(res.data, empresa.nome_fantasia);
      const raw = buildFocusCnpjConsultaRecord(res.data);
      setFocusConsultaRecord(raw);
      const nextEmpresa = { ...empresa, ...applied.empresa, cnpj_cpf: digits };
      const nextEndereco = { ...endereco, ...applied.endereco };
      const nextSetup = mergeSetupPatch(setup, {
        focus_cnpj_lock: applied.lock,
      });
      setEmpresa(nextEmpresa);
      setEndereco(nextEndereco);
      setSetup(nextSetup);
      if (companyId) {
        const patchRes = await patchCompanyMaps(companyId, {
          empresa: {
            ...nextEmpresa,
            telefone: (nextEmpresa.telefone ?? "").replace(/\D/g, ""),
          },
          endereco_principal: nextEndereco,
          focus_cnpj_consulta: raw,
          setup: nextSetup,
          document: digits,
        });
        if (patchRes.error) {
          toast.error(patchRes.error);
          return false;
        }
      }
      return true;
    } finally {
      setCnpjValidating(false);
    }
  }, [empresa, endereco, setup, companyId]);

  const handlePause = async () => {
    if (!user) return;
    if (!companyId) {
      toast.error(
        "Conclua o certificado com sucesso para salvar a unidade na Faro e poder pausar.",
      );
      return;
    }
    setSaving(true);
    try {
      const paused = buildPausedSetup(syncCompletionState(setup));
      await patchCompanyMaps(companyId, {
        empresa,
        endereco_principal: endereco,
        focus_cnpj_consulta: focusConsultaRecord,
        focusnfe,
        setup: paused,
        name:
          (empresa.nome_fantasia ?? "").trim() ||
          empresa.nome_razao_social?.trim() ||
          undefined,
        document: (empresa.cnpj_cpf ?? "").replace(/\D/g, "") || undefined,
        email: (empresa.email ?? "").trim() || null,
        phone: (empresa.telefone ?? "").replace(/\D/g, "") || null,
      });
      setSetup(paused);
      await refetchCompanies();
      toast.message("Setup pausado. Você pode retomar pelo início.");
      exitApp();
    } finally {
      setSaving(false);
    }
  };

  /** Passo 1 sem `companyId`: valida; a unidade na Faro é criada após sucesso na Focus (certificado). */
  const runAdvanceStep1Local = (): boolean => {
    const err = validateStep1Empresa(empresa, {
      requireFocusCnpjValidation: true,
      focusCnpjLock: setup.focus_cnpj_lock,
    });
    if (err) {
      setStepError(err);
      return false;
    }
    if (!createNewGroup && !newUnitGroupId) {
      setStepError("Grupo inválido.");
      return false;
    }
    if (!isStep2EnderecoComplete(endereco)) {
      setStepError(
        "Valide o CNPJ: o endereço deve vir completo da consulta antes do certificado.",
      );
      return false;
    }
    return true;
  };

  const runCreateCompanyAfterFocusSuccess = async (
    focusnfeForDb: FocusNfeMap,
  ): Promise<boolean> => {
    if (!user) return false;
    const docDigits = (empresa.cnpj_cpf ?? "").replace(/\D/g, "");
    const phoneDigits = (empresa.telefone ?? "").replace(/\D/g, "");
    const empresaPayload: EmpresaMap = {
      ...empresa,
      cnpj_cpf: docDigits,
      telefone: phoneDigits,
    };
    const certOut: SetupCertificateState = {
      mode: "upload_now",
      status: "valid",
      file_name: setup.certificate?.file_name,
      updated_at: new Date().toISOString(),
    };
    const created = await createCompanyFromSetupStep1(
      createNewGroup
        ? {
            mode: "new_group",
            ownerUserId: user.id,
            groupName: groupName.trim(),
            empresa: empresaPayload,
            endereco_principal: endereco,
            focus_cnpj_consulta: focusConsultaRecord,
            afterFocusCriaSuccess: true,
            focusnfe: focusnfeForDb,
            setupExtension: {
              focus_cnpj_lock: setup.focus_cnpj_lock,
              certificate: certOut,
            },
          }
        : {
            mode: "existing_group",
            ownerUserId: user.id,
            groupId: newUnitGroupId!,
            empresa: empresaPayload,
            endereco_principal: endereco,
            focus_cnpj_consulta: focusConsultaRecord,
            afterFocusCriaSuccess: true,
            focusnfe: focusnfeForDb,
            setupExtension: {
              focus_cnpj_lock: setup.focus_cnpj_lock,
              certificate: certOut,
            },
          },
    );
    if ("error" in created) {
      toast.error(created.error);
      return false;
    }
    setCompanyId(created.companyId);
    setCertFileBase64("");
    setCertPassword("");
    setFocusnfe(stripFocusnfeSecrets(focusnfeForDb));
    const nextSetup = syncCompletionState(
      mergeSetupPatch(setup, {
        current_step: 3,
        certificate: certOut,
      }),
    );
    setSetup(nextSetup);
    await refetchCompanies();
    if (!isModal) {
      navigate(`/empresas/unidade/setup/${created.companyId}`, {
        replace: true,
      });
    }
    toast.success("Unidade criada na Faro.");
    return true;
  };

  const ensureCompanyCreatedWithoutFocus = async (): Promise<string | null> => {
    if (companyId) return companyId;
    if (!user) return null;
    if (!runAdvanceStep1Local()) return null;

    const docDigits = (empresa.cnpj_cpf ?? "").replace(/\D/g, "");
    const phoneDigits = (empresa.telefone ?? "").replace(/\D/g, "");
    const empresaPayload: EmpresaMap = {
      ...empresa,
      cnpj_cpf: docDigits,
      telefone: phoneDigits,
    };
    const certMode: CertificateFiscalMode =
      setup.certificate?.mode === "delegate_link" ? "delegate_link" : "skip";
    const certOut: SetupCertificateState = {
      mode: certMode,
      status: certMode === "delegate_link" ? "delegated_pending" : "not_sent",
      delegation_link_id: setup.certificate?.delegation_link_id,
      updated_at: new Date().toISOString(),
    };

    const created = await createCompanyFromSetupStep1(
      createNewGroup
        ? {
            mode: "new_group",
            ownerUserId: user.id,
            groupName: groupName.trim(),
            empresa: empresaPayload,
            endereco_principal: endereco,
            focus_cnpj_consulta: focusConsultaRecord,
            afterFocusCriaSuccess: false,
            setupExtension: {
              focus_cnpj_lock: setup.focus_cnpj_lock,
              certificate: certOut,
            },
          }
        : {
            mode: "existing_group",
            ownerUserId: user.id,
            groupId: newUnitGroupId!,
            empresa: empresaPayload,
            endereco_principal: endereco,
            focus_cnpj_consulta: focusConsultaRecord,
            afterFocusCriaSuccess: false,
            setupExtension: {
              focus_cnpj_lock: setup.focus_cnpj_lock,
              certificate: certOut,
            },
          },
    );
    if ("error" in created) {
      toast.error(created.error);
      return null;
    }
    setCompanyId(created.companyId);
    const nextSetup = syncCompletionState(
      mergeSetupPatch(setup, { certificate: certOut }),
    );
    setSetup(nextSetup);
    await refetchCompanies();
    if (!isModal) {
      navigate(`/empresas/unidade/setup/${created.companyId}`, {
        replace: true,
      });
    }
    return created.companyId;
  };

  const handleCertModeChange = (mode: CertificateFiscalMode) => {
    if (mode !== "delegate_link") {
      setDelegationLinkUrl(null);
      setLinkCopied(false);
    }
    const nextCert: SetupCertificateState = {
      ...(setup.certificate ?? { status: "not_sent" }),
      mode,
      status:
        mode === "delegate_link"
          ? "delegated_pending"
          : mode === "skip"
            ? "not_sent"
            : (setup.certificate?.status ?? "not_sent"),
      updated_at: new Date().toISOString(),
    };
    setSetup((s) =>
      syncCompletionState(s, { certificate: nextCert }, {
        certBase64: certFileBase64,
        certPassword,
      }),
    );
    if (companyId) {
      void patchCompanyMaps(companyId, {
        setup: syncCompletionState(setup, { certificate: nextCert }),
      });
    }
  };

  const handlePdvOptionChange = (option: PdvSalesOption) => {
    setEpocValidateError(null);
    setStepError(null);
    const patch: Partial<SetupEpocState> = {
      pdv_option: option,
      mode: pdvOptionToMode(option),
      updated_at: new Date().toISOString(),
    };
    if (option !== "other_system") {
      patch.other_system_name = undefined;
    }
    if (option === "epoc") {
      patch.enabled = setup.epoc?.enabled ?? true;
    }
    setSetup((s) =>
      mergeSetupPatch(s, {
        epoc: { ...(s.epoc ?? { mode: "undecided" }), ...patch },
      }),
    );
  };

  const handleGenerateDelegationLink = async () => {
    setStepError(null);
    setLinkGenerating(true);
    try {
      const id = await ensureCompanyCreatedWithoutFocus();
      if (!id) return;
      const res = await createSetupCertificateDelegationLink(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setDelegationLinkUrl(res.url);
      const nextCert: SetupCertificateState = {
        ...(setup.certificate ?? { status: "delegated_pending" }),
        mode: "delegate_link",
        status: "delegated_pending",
        delegation_link_id: res.linkId,
        updated_at: new Date().toISOString(),
      };
      const nextSetup = syncCompletionState(setup, { certificate: nextCert });
      setSetup(nextSetup);
      await patchCompanyMaps(id, { setup: nextSetup });
      toast.success("Link gerado. Compartilhe com quem vai enviar o certificado.");
    } finally {
      setLinkGenerating(false);
    }
  };

  const handleCopyDelegationLink = async () => {
    if (!delegationLinkUrl) return;
    try {
      await navigator.clipboard.writeText(delegationLinkUrl);
      setLinkCopied(true);
      toast.success("Link copiado.");
      window.setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      toast.error("Não foi possível copiar o link.");
    }
  };

  const runStep1Patch = async (): Promise<boolean> => {
    const err = validateStep1Empresa(empresa, {
      requireFocusCnpjValidation: true,
      focusCnpjLock: setup.focus_cnpj_lock,
    });
    if (err) {
      setStepError(err);
      return false;
    }
    if (!isStep2EnderecoComplete(endereco)) {
      setStepError(
        "Valide o CNPJ: o endereço deve vir completo da consulta antes do certificado.",
      );
      return false;
    }
    if (!companyId) return false;
    setSaving(true);
    const docDigits = (empresa.cnpj_cpf ?? "").replace(/\D/g, "");
    const phoneDigits = (empresa.telefone ?? "").replace(/\D/g, "");
    const displayName =
      (empresa.nome_fantasia ?? "").trim() ||
      (empresa.nome_razao_social ?? "").trim();
    const nextSetup = syncCompletionState(
      mergeSetupPatch(setup, { current_step: 2 }),
    );
    const res = await patchCompanyMaps(companyId, {
      empresa: { ...empresa, cnpj_cpf: docDigits, telefone: phoneDigits },
      endereco_principal: endereco,
      focus_cnpj_consulta: focusConsultaRecord,
      setup: nextSetup,
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

    if (includeGroupStep && activeStep === 1) {
      if (!groupName.trim()) {
        setStepError("Informe o nome do grupo.");
        return;
      }
      setActiveStep(2);
      return;
    }

    if (activeStep === empresaWizardStep) {
      if (!cnpjValidated) {
        const digits = unmask(empresa.cnpj_cpf ?? "");
        if (digits.length !== 14) {
          setStepError("Informe o CNPJ completo (14 dígitos) antes de buscar.");
          return;
        }
        if (!isValidCnpj(digits)) {
          setStepError("Informe um CNPJ válido.");
          return;
        }
        await handleValidarCnpj();
        return;
      }
      if (!companyId) {
        if (!runAdvanceStep1Local()) return;
        setActiveStep(certWizardStep);
        return;
      }
      const ok = await runStep1Patch();
      if (ok) setActiveStep(certWizardStep);
      return;
    }

    if (activeStep === certWizardStep) {
      const fiscalErr = isFiscalStepAdvanceAllowed(
        setup.certificate,
        { certBase64: certFileBase64, certPassword },
        { companyId },
      );
      if (fiscalErr) {
        setStepError(fiscalErr);
        return;
      }

      const certMode: CertificateFiscalMode =
        setup.certificate?.mode ?? "undecided";

      if (certMode === "skip") {
        setSaving(true);
        const createdId = await ensureCompanyCreatedWithoutFocus();
        if (!createdId) {
          setSaving(false);
          return;
        }
        const certOut: SetupCertificateState = {
          mode: "skip",
          status: "not_sent",
          updated_at: new Date().toISOString(),
        };
        let nextSetup = syncCompletionState(
          mergeSetupPatch(setup, {
            current_step: 3,
            certificate: certOut,
          }),
        );
        nextSetup = markStepSkipped(nextSetup, 2);
        const res = await patchCompanyMaps(createdId, { setup: nextSetup });
        setSaving(false);
        if (res.error) {
          toast.error(res.error);
          return;
        }
        setSetup(nextSetup);
        setActiveStep(pdvWizardStep);
        return;
      }

      if (certMode === "delegate_link") {
        setSaving(true);
        const createdId = await ensureCompanyCreatedWithoutFocus();
        if (!createdId) {
          setSaving(false);
          return;
        }
        const certOut: SetupCertificateState = {
          mode: "delegate_link",
          status: "delegated_pending",
          delegation_link_id: setup.certificate?.delegation_link_id,
          updated_at: new Date().toISOString(),
        };
        const nextSetup = syncCompletionState(
          mergeSetupPatch(setup, {
            current_step: 3,
            certificate: certOut,
          }),
        );
        const res = await patchCompanyMaps(createdId, { setup: nextSetup });
        setSaving(false);
        if (res.error) {
          toast.error(res.error);
          return;
        }
        setSetup(nextSetup);
        setActiveStep(pdvWizardStep);
        return;
      }

      if (!companyId) {
        const err1 = validateStep1Empresa(empresa, {
          requireFocusCnpjValidation: true,
          focusCnpjLock: setup.focus_cnpj_lock,
        });
        if (err1) {
          setStepError(err1);
          return;
        }
        if (!isStep2EnderecoComplete(endereco)) {
          setStepError(
            "Valide o CNPJ: o endereço deve vir completo da consulta antes de avançar.",
          );
          return;
        }
        const docDigits = (empresa.cnpj_cpf ?? "").replace(/\D/g, "");
        const phoneDigits = (empresa.telefone ?? "").replace(/\D/g, "");
        const empresaPayload: EmpresaMap = {
          ...empresa,
          cnpj_cpf: docDigits,
          telefone: phoneDigits,
        };
        const body = buildFocusCriaEmpresaBody({
          empresa: empresaPayload,
          endereco,
          arquivo_certificado_base64: certFileBase64.trim(),
          senha_certificado: certPassword.trim(),
        });
        setSaving(true);
        const foc = await focusCriaEmpresa(body);
        if (!foc.ok) {
          setSaving(false);
          setStepError(foc.error);
          toast.error(foc.error);
          return;
        }
        const idEmpresaFocus =
          parseFocusCriaEmpresaIdFromResponse(foc.data) ??
          parseFocusCriaEmpresaIdFromResponse(foc.envelope);
        const certValidadeFromCreate =
          parseFocusCertificadoValidoAteFromResponse(foc.data) ??
          parseFocusCertificadoValidoAteFromResponse(foc.envelope);
        if (idEmpresaFocus == null) {
          toast.warning(
            "Empresa criada na Focus, mas o id não veio na resposta. Confira a edge ou cadastre o id manualmente em focusnfe.id_empresa.",
            { duration: 8000 },
          );
        }
        const focusnfeForDb: FocusNfeMap = {
          ...stripFocusnfeSecrets(focusnfe),
          ...(idEmpresaFocus != null ? { id_empresa: idEmpresaFocus } : {}),
          ...(certValidadeFromCreate
            ? {
                certificado_ativo: true,
                certificado_validade: certValidadeFromCreate,
              }
            : {}),
        };
        const okCreate = await runCreateCompanyAfterFocusSuccess(focusnfeForDb);
        setSaving(false);
        if (!okCreate) return;
        setActiveStep(pdvWizardStep);
        return;
      }

      let nextFocus = stripFocusnfeSecrets(focusnfe);
      const cert = setup.certificate;
      let certOut = cert;
      const pwd = certPassword.trim();
      const b64 = certFileBase64.trim();
      const alreadyValid =
        cert?.status === "valid" && pwd.length === 0 && b64.length === 0;

      if (!alreadyValid) {
        if (!pwd) {
          setStepError("Informe a senha do certificado para validar.");
          return;
        }
        if (!cert?.file_name) {
          setStepError("Envie o arquivo do certificado (PFX/P12).");
          return;
        }
        if (!b64 && !cert?.storage_path) {
          setStepError("Aguarde o carregamento do arquivo ou envie novamente.");
          return;
        }
        if (cert?.status === "invalid") {
          setStepError("Certificado inválido. Envie outro arquivo.");
          return;
        }

        setCertBusy(true);
        const val = await validateCertificateWithFocusNfe({
          companyId,
          password: pwd,
          certBase64: b64 || undefined,
          storagePath: cert?.storage_path || undefined,
        });
        setCertBusy(false);
        if (val.status !== "valid") {
          setStepError(
            val.error_message ?? "Não foi possível validar o certificado.",
          );
          toast.error(val.error_message ?? "Certificado inválido.");
          return;
        }
        if (hasFocusNfeEmpresaId(focusnfe) && b64) {
          const fx = await focusAtualizarCertificado({
            companyId,
            removeCertificate: false,
            arquivo_certificado_base64: b64,
            senha_certificado: pwd,
          });
          if (!fx.ok) {
            setStepError(fx.error);
            toast.error(fx.error);
            return;
          }
        }
        nextFocus = {
          ...nextFocus,
          certificado_ativo: true,
          certificado_validade: val.certificado_validade,
        };
        certOut = {
          ...cert,
          mode: "upload_now",
          status: val.status,
          updated_at: new Date().toISOString(),
        };
        setCertPassword("");
        setCertFileBase64("");
      }

      setFocusnfe(nextFocus);
      setSaving(true);
      const nextSetup = syncCompletionState(
        mergeSetupPatch(setup, {
          current_step: 3,
          certificate: certOut,
        }),
      );
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
      setActiveStep(pdvWizardStep);
      return;
    }

    if (activeStep === pdvWizardStep) {
      if (!companyId) {
        toast.error("Conclua o certificado para criar a unidade.");
        return;
      }
      const ep = setup.epoc ?? { mode: "undecided" as const };
      const pdvErr = isPdvStepAdvanceAllowed(ep);
      if (pdvErr) {
        setStepError(pdvErr);
        return;
      }
      setStepError(null);

      const option = resolvePdvOption(ep);
      const epOut: SetupEpocState = {
        ...ep,
        pdv_option: option,
        mode: pdvOptionToMode(option),
        updated_at: new Date().toISOString(),
      };

      setSaving(true);
      if (option === "epoc") {
        const u = (epOut.username ?? "").trim();
        const enabled = epOut.enabled ?? false;
        const pwdInput = (epOut.password ?? "").trim();
        let pwdFinal = pwdInput;

        const { data: existingRow } = await supabase
          .from("company_integrations")
          .select("settings")
          .eq("company_id", companyId)
          .eq("provider", "epoc")
          .maybeSingle();

        if (
          enabled &&
          !pwdFinal &&
          epOut.password_on_server &&
          existingRow?.settings
        ) {
          const prev = parseEpocSettings(
            existingRow.settings as Record<string, unknown>,
          );
          if (prev.password) pwdFinal = prev.password;
        }

        const baseUrlTrimmed = (epOut.base_url ?? "").trim();
        if (
          shouldValidateEpocBeforeStep3Complete(epOut, {
            hasResolvedPassword: Boolean(pwdFinal && pwdFinal.trim()),
            baseUrlTrimmed,
            usernameTrimmed: u,
          })
        ) {
          const v = await invokeValidateEpocLogin({
            companyId,
            baseUrl: baseUrlTrimmed,
            username: u,
            password: pwdFinal,
            codigo_filial: (epOut.codigo_filial ?? "").trim() || undefined,
          });
          if (!v.success) {
            setEpocValidateError({
              message: v.message,
              errorCode: v.errorCode,
            });
            setSaving(false);
            return;
          }
          setEpocValidateError(null);
        }

        if (u && (!enabled || pwdFinal)) {
          const settings: EpocIntegrationSettings = {
            username: u,
            base_url: (epOut.base_url ?? "").trim() || undefined,
            codigo_filial: (epOut.codigo_filial ?? "").trim() || undefined,
            ambiente: epOut.ambiente ?? "producao",
          };
          if (pwdFinal) settings.password = pwdFinal;

          const merged = mergeEpocSettingsForUpsert(
            existingRow?.settings as Record<string, unknown> | undefined,
            settings,
          );

          const { error: epocUpsertError } = await supabase
            .from("company_integrations")
            .upsert(
              {
                company_id: companyId,
                provider: "epoc",
                enabled,
                settings: merged,
                updated_at: new Date().toISOString(),
              },
              { onConflict: "company_id,provider" },
            );
          if (epocUpsertError) {
            setSaving(false);
            toast.error(epocUpsertError.message);
            return;
          }
          if (enabled && (epOut.base_url ?? "").trim()) {
            triggerEpocCsvSyncInBackground(companyId, {
              sync_mode: "onboarding_initial",
              lockOnboardingPdv: true,
            });
            void refetchCompanies();
            toast.message(
              "Sincronização EPOC em segundo plano: período desde o início do mês anterior até ontem.",
              { duration: 5500 },
            );
          }
        }
      }
      const nextSetup = syncCompletionState(
        mergeSetupPatch(setup, { current_step: 3, epoc: epOut }),
      );
      const res = await patchCompanyMaps(companyId, {
        setup: nextSetup,
        focusnfe: stripFocusnfeSecrets(focusnfe),
      });
      setSaving(false);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      setSetup(nextSetup);
      setActiveStep(whatsappWizardStep);
      return;
    }

    if (activeStep === whatsappWizardStep) {
      if (!companyId) {
        toast.error("Conclua os passos anteriores para criar a unidade.");
        return;
      }
      const waErr = isWhatsappStepAdvanceAllowed(whatsappPhoneDigits);
      if (waErr) {
        setStepError(waErr);
        return;
      }
      setStepError(null);

      const notification = buildNotificationPayload(
        whatsappPhoneDigits,
        whatsappRules,
      );
      if (notification.length === 0) {
        setStepError("Informe um WhatsApp válido.");
        return;
      }

      setSaving(true);
      const nextSetup = syncCompletionState(
        mergeSetupPatch(setup, { current_step: 4 }),
        undefined,
        undefined,
        notification,
      );
      const res = await patchCompanyMaps(companyId, {
        notification,
        setup: nextSetup,
        focusnfe: stripFocusnfeSecrets(focusnfe),
      });
      setSaving(false);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      setCompanyNotification(notification);
      setSetup(nextSetup);
      setPhase("finalize_loading");
      await finalizeRun(nextSetup, focusnfe);
      return;
    }
  };

  async function finalizeRun(lastSetup: CompanySetupMap, focus: FocusNfeMap) {
    if (!companyId) return;
    await syncFocusNfeCompanyProfile(companyId, focus);
    const pending = getNextPendingStep(lastSetup);
    const allDone = pending > TOTAL_STEPS;
    const completed = buildCompletedSetup(lastSetup, {
      allApplicableDone: allDone,
    });
    const pdvOption = resolvePdvOption(lastSetup.epoc);
    await patchCompanyMaps(companyId, {
      setup: completed,
      ...(pdvOption === "no_system" || pdvOption === "other_system"
        ? {
            onboarding_pdv: mergeOnboardingPdv(undefined, {
              completed: true,
              sync: false,
            }),
          }
        : {}),
    });
    setSetup(completed);
    await refetchCompanies();
    if (isModal) {
      exitApp({ companyId, completed: true });
      return;
    }
    setPhase("finalize_summary");
  }

  const handleBack = () => {
    if (activeStep <= 1) return;
    const target = activeStep - 1;
    if (
      lockStepsOneToTwo &&
      target >= empresaWizardStep &&
      target <= certWizardStep
    ) {
      toast.message(
        "Após criar a unidade com sucesso, não é possível voltar aos passos Unidade ou Certificado.",
      );
      return;
    }
    if (activeStep === pdvWizardStep) setEpocValidateError(null);
    if (activeStep === whatsappWizardStep) setStepError(null);
    setActiveStep((s) => s - 1);
  };

  const handleRemoveCertificate = useCallback(async () => {
    const path = setup.certificate?.storage_path;
    if (path && companyId) {
      const { error } = await supabase.storage
        .from("company-setup")
        .remove([path]);
      if (error) toast.error(error.message);
    }
    if (companyId && hasFocusNfeEmpresaId(focusnfe)) {
      const fx = await focusAtualizarCertificado({
        companyId,
        removeCertificate: true,
      });
      if (!fx.ok) {
        toast.error(fx.error);
        return;
      }
    }
    setCertFileBase64("");
    setCertPassword("");
    const cleared = {
      status: "not_sent" as const,
      updated_at: new Date().toISOString(),
    };
    const nextFocus = {
      ...stripFocusnfeSecrets(focusnfe),
      certificado_ativo: false,
      certificado_validade: undefined,
    };
    const nextSetup = syncCompletionState(
      mergeSetupPatch(setup, { certificate: cleared }),
      undefined,
      { certBase64: "", certPassword: "" },
    );
    setFocusnfe(nextFocus);
    setSetup(nextSetup);
    if (companyId) {
      const res = await patchCompanyMaps(companyId, {
        setup: nextSetup,
        focusnfe: nextFocus,
      });
      if (res.error) toast.error(res.error);
    }
  }, [companyId, focusnfe, setup, syncCompletionState]);

  const handleCertFile = async (file: File) => {
    setCertBusy(true);
    try {
      const base64 = await fileToPureBase64(file);
      const certStateBase: SetupCertificateState = {
        mode: "upload_now",
        status: "uploaded",
        file_name: file.name,
        updated_at: new Date().toISOString(),
      };
      setCertFileBase64(base64);
      const nextSetup = syncCompletionState(
        mergeSetupPatch(setup, { certificate: certStateBase }),
        undefined,
        { certBase64: base64, certPassword },
      );
      setSetup(nextSetup);
      if (companyId) {
        const res = await patchCompanyMaps(companyId, { setup: nextSetup });
        if (res.error) {
          toast.error(res.error);
          return;
        }
        toast.success(
          "Certificado carregado. Informe a senha e avançe para validar.",
        );
      } else {
        toast.success(
          "Certificado carregado — informe a senha para concluir o passo.",
        );
      }
    } finally {
      setCertBusy(false);
    }
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
      <div
        className={`flex ${loadingMinH} flex-col items-center justify-center gap-4`}
      >
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
            <p className="font-medium">Certificado</p>
            <p className="text-muted-foreground">
              {setup.certificate?.mode === "skip"
                ? "Não enviado (pode conectar depois)"
                : setup.certificate?.mode === "delegate_link" &&
                    setup.certificate?.status === "delegated_pending"
                  ? "Aguardando envio por link"
                  : setup.certificate?.status === "valid"
                    ? `Válido até ${focusnfe.certificado_validade ?? "—"}`
                    : (setup.certificate?.status ?? "não enviado")}
            </p>
          </div>
          <div>
            <p className="font-medium">Suas Vendas</p>
            <p className="text-muted-foreground">
              {(() => {
                const option = resolvePdvOption(setup.epoc);
                if (option === "no_system") return "Sem sistema de vendas";
                if (option === "other_system") {
                  const name = (setup.epoc?.other_system_name ?? "").trim();
                  return name ? `Outro sistema: ${name}` : "Outro sistema";
                }
                if (option === "epoc") {
                  return setup.epoc?.enabled
                    ? "Epoc — integração ativa"
                    : "Epoc — credenciais salvas (inativa)";
                }
                return "—";
              })()}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Notas fiscais (XML/ZIP) podem ser importadas depois na página{" "}
              Importações.
            </p>
          </div>
          <div>
            <p className="font-medium">WhatsApp</p>
            <p className="text-muted-foreground">
              {companyNotification[0]?.number
                ? formatNormalizedForDisplay(companyNotification[0].number)
                : "—"}
            </p>
            {companyNotification[0]?.rules?.length ? (
              <ul className="mt-1 list-inside list-disc text-sm text-muted-foreground">
                {companyNotification[0].rules.map((rule) => (
                  <li key={rule}>{NOTIFICATION_RULE_LABELS[rule].title}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nenhum alerta selecionado
              </p>
            )}
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

  const fiscalAdvanceBlocked =
    activeStep === certWizardStep &&
    isFiscalStepAdvanceAllowed(
      setup.certificate,
      { certBase64: certFileBase64, certPassword },
      { companyId },
    ) != null;

  const pdvAdvanceBlocked =
    activeStep === pdvWizardStep &&
    isPdvStepAdvanceAllowed(setup.epoc) != null;

  const whatsappAdvanceBlocked =
    activeStep === whatsappWizardStep &&
    isWhatsappStepAdvanceAllowed(whatsappPhoneDigits) != null;

  const handleWhatsappRuleToggle = (rule: CompanyNotificationRule) => {
    setWhatsappRules((prev) =>
      prev.includes(rule) ? prev.filter((r) => r !== rule) : [...prev, rule],
    );
  };

  const getPrimaryButtonLabel = (): string => {
    if (saving) {
      if (activeStep === pdvWizardStep) return "A validar…";
      if (activeStep === whatsappWizardStep) return "Ativando WhatsApp…";
      return "Salvando…";
    }
    if (cnpjValidating) return "Buscando na Receita...";
    if (activeStep === empresaWizardStep) {
      if (!cnpjValidated) return "Buscar meu CNPJ →";
      return "Confirmar e continuar";
    }
    if (activeStep === whatsappWizardStep) return "Ativar WhatsApp";
    return "Continuar";
  };

  const wizardHeader = (
    <>
      <div className="space-y-3" aria-label="Faro">
        <img
          src={resolvedTheme === "dark" ? logoDark : logoLight}
          alt="Faro"
          width={128}
          height={64}
          className="h-8 w-auto shrink-0 object-contain"
        />

        <SetupStepper
          activeStep={activeStep}
          setup={setup}
          includeGroupStep={includeGroupStep}
        />
      </div>

      <p className="text-sm font-medium text-primary">
        Passo {activeStep} de {totalWizardSteps}
        <span className="mx-1.5" aria-hidden>
          ·
        </span>
        {wizardStepLabel(activeStep, includeGroupStep)}
      </p>

      <PageHeader
        title={wizardPageTitle(activeStep, includeGroupStep)}
        description={wizardStepHint(activeStep, includeGroupStep)}
        icon={Building2}
        className={isModal ? "pb-1" : undefined}
      />

      {stepError ? (
        <p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          {stepError}
        </p>
      ) : null}
    </>
  );

  const wizardStepCard = (
    <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm">
      <div className="p-4 sm:p-6">
        {includeGroupStep && activeStep === 1 ? (
          <StepGroupForm
            groupName={groupName}
            onGroupNameChange={setGroupName}
          />
        ) : null}
        {activeStep === empresaWizardStep ? (
          <StepCompanyForm
            groupName={groupName}
            onGroupNameChange={setGroupName}
            showGroupName={false}
            empresa={{
              ...empresa,
              cnpj_cpf: empresa.cnpj_cpf ?? "",
              telefone: empresa.telefone ?? "",
            }}
            onEmpresaChange={applyEmpresaPatch}
            lockedEmpresaKeys={setup.focus_cnpj_lock?.locked_empresa_keys}
            cnpjValidated={cnpjValidated}
          />
        ) : null}
        {activeStep === certWizardStep ? (
          <StepCertificateForm
            compact={isModal}
            cert={setup.certificate}
            password={certPassword}
            onPasswordChange={(v) => {
              setCertPassword(v);
              setSetup((s) =>
                syncCompletionState(s, undefined, {
                  certBase64: certFileBase64,
                  certPassword: v,
                }),
              );
            }}
            onPickFile={(f) => void handleCertFile(f)}
            onRemoveCertificate={() => void handleRemoveCertificate()}
            onModeChange={handleCertModeChange}
            busy={certBusy}
            delegationLinkUrl={delegationLinkUrl}
            onGenerateLink={() => void handleGenerateDelegationLink()}
            linkGenerating={linkGenerating}
            onCopyLink={() => void handleCopyDelegationLink()}
            linkCopied={linkCopied}
          />
        ) : null}
        {activeStep === pdvWizardStep ? (
          <StepPdvForm
            epoc={setup.epoc}
            validationError={epocValidateError}
            onPdvOptionChange={handlePdvOptionChange}
            onEpocChange={(patch) => {
              setEpocValidateError(null);
              setSetup((s) =>
                mergeSetupPatch(s, {
                  epoc: { ...(s.epoc ?? { mode: "undecided" }), ...patch },
                }),
              );
            }}
          />
        ) : null}
        {activeStep === whatsappWizardStep ? (
          <StepWhatsappForm
            phoneDigits={whatsappPhoneDigits}
            rules={whatsappRules}
            onPhoneChange={setWhatsappPhoneDigits}
            onRuleToggle={handleWhatsappRuleToggle}
          />
        ) : null}
      </div>
    </div>
  );

  const wizardFooter = (
    <div
      className={cn(
        "flex flex-col-reverse gap-3 sm:flex-row sm:items-center",
        !isModal && "border-t border-border/60 pt-4 sm:pt-5",
        activeStep === pdvWizardStep || activeStep === whatsappWizardStep
          ? "sm:justify-between"
          : "sm:justify-end",
      )}
    >
      {activeStep === pdvWizardStep || activeStep === whatsappWizardStep ? (
        <Button
          type="button"
          variant="ghost"
          className="w-full text-muted-foreground sm:w-auto"
          onClick={() => void handlePause()}
          disabled={saving}
        >
          Pausar e continuar depois
        </Button>
      ) : null}
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          className="w-full sm:w-auto"
          onClick={
            activeStep === 1
              ? () => requestLeaveConfirm(() => exitApp())
              : handleBack
          }
          disabled={saving || (lockStepsOneToTwo && activeStep === pdvWizardStep)}
        >
          {activeStep === 1 ? "Cancelar" : "Voltar"}
        </Button>
        <Button
          type="button"
          className="w-full min-w-32 sm:w-auto"
          onClick={() => void handleNext()}
          disabled={
            saving ||
            certBusy ||
            cnpjValidating ||
            fiscalAdvanceBlocked ||
            pdvAdvanceBlocked ||
            whatsappAdvanceBlocked
          }
        >
          {saving || cnpjValidating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {getPrimaryButtonLabel()}
            </>
          ) : (
            getPrimaryButtonLabel()
          )}
        </Button>
      </div>
    </div>
  );

  const wizardBody = (
    <>
      {wizardHeader}
      {wizardStepCard}
      {wizardFooter}
    </>
  );

  return isModal ? (
    <div className="flex h-[min(82vh,680px)] min-h-[min(82vh,560px)] flex-col gap-4">
      <div className="shrink-0 space-y-3">{wizardHeader}</div>
      <div className="min-h-0 flex-1 overflow-y-auto">{wizardStepCard}</div>
      <div className="shrink-0 border-t border-border/60 bg-background pt-4">
        {wizardFooter}
      </div>
    </div>
  ) : (
    <PageShell className="max-w-2xl space-y-6">{wizardBody}</PageShell>
  );
}
