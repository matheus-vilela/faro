import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useCompany } from "@/contexts/CompanyContext";
import {
  applyFocusCnpjConsulta,
  buildFocusCnpjConsultaRecord,
  clearFocusCnpjFilledFields,
  resolveFocusCnpjLockForResume,
} from "@/lib/focusCnpjApply";
import { stripFocusnfeSecrets } from "@/lib/focusNfeSanitize";
import { maskCpfCnpj, unmask } from "@/lib/masks";
import {
  getNextPendingStep,
  mergeSetupPatch,
  TOTAL_STEPS,
} from "@/lib/setup/setupProgress";
import {
  getStep6EpocState,
  isStep1EmpresaComplete,
  isStep2EnderecoComplete,
  isStep3CertificatePayloadComplete,
  isStep4CertificateComplete,
  validateStep1Empresa,
} from "@/lib/setup/validation";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
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
  buildCompletedSetup,
  buildPausedSetup,
  createCompanyFromSetupStep1,
  fetchCompanySetupRow,
  normalizeSetupMap,
  patchCompanyMaps,
} from "@/services/unitSetupService";
import {
  mergeEpocSettingsForUpsert,
  parseEpocSettings,
  type EpocIntegrationSettings,
} from "@/types/companyIntegration";
import type {
  CompanySetupMap,
  EmpresaMap,
  EnderecoPrincipalMap,
  FocusNfeMap,
  RepresentanteLegalMap,
  SetupStepNumber,
} from "@/types/companySetup";
import { Building2, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  SETUP_STEP_HINTS,
  SETUP_STEP_LABELS,
  SetupStepper,
} from "./SetupStepper";
import { StepCertificateForm } from "./steps/StepCertificateForm";
import { StepCompanyForm } from "./steps/StepCompanyForm";
import { StepPdvForm } from "./steps/StepPdvForm";

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

function emptyRepresentante(): RepresentanteLegalMap {
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
  const [representanteLegal, setRepresentanteLegal] =
    useState<RepresentanteLegalMap>(emptyRepresentante);
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

  const [loading, setLoading] = useState(!!resumeCompanyId);
  const [saving, setSaving] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);

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
      representante_legal?: Record<string, unknown> | null;
      focus_cnpj_consulta?: Record<string, unknown> | null;
    };
    setCompanyId(c.id);
    setEmpresa((c.empresa ?? {}) as EmpresaMap);
    setEndereco((c.endereco_principal ?? {}) as EnderecoPrincipalMap);
    setFocusnfe(stripFocusnfeSecrets((c.focusnfe ?? {}) as FocusNfeMap));
    setCertFileBase64("");
    setCertPassword("");
    setRepresentanteLegal(
      (c.representante_legal ?? {}) as RepresentanteLegalMap,
    );
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

    if (integRow && su.epoc?.mode !== "no") {
      const s = parseEpocSettings(
        (integRow.settings ?? {}) as Record<string, unknown>,
      );
      su = mergeSetupPatch(su, {
        epoc: {
          mode: "credentials",
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

    setSetup(su);
    setActiveStep(
      Math.min(3, Math.max(1, su.current_step ?? getNextPendingStep(su))),
    );
  }, [resumeCompanyId]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const syncCompletionState = useCallback(
    (
      base: CompanySetupMap,
      overrides?: Partial<CompanySetupMap>,
      certSecrets?: { certBase64: string; certPassword: string },
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
      const s2cert = companyId
        ? isStep4CertificateComplete(merged.certificate)
        : isStep3CertificatePayloadComplete(merged.certificate, sec);
      const s3ep = getStep6EpocState(merged.epoc);

      let completed = merged.completed_steps ?? [];
      let skipped = merged.skipped_steps ?? [];
      completed = upsertStep(completed, 1, s1);
      completed = upsertStep(completed, 2, s2cert);
      completed = upsertStep(completed, 3, s3ep.completed);
      skipped = upsertStep(skipped, 3, s3ep.skipped);

      return mergeSetupPatch(merged, {
        completed_steps: completed,
        skipped_steps: skipped,
      });
    },
    [companyId, empresa, certFileBase64, certPassword],
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
          representanteLegal,
          setup.focus_cnpj_lock,
        );
        setEmpresa({ ...cleared.empresa, cnpj_cpf: nextDigits });
        setEndereco(cleared.endereco);
        setRepresentanteLegal(cleared.representante);
        setSetup((s) => mergeSetupPatch(s, { focus_cnpj_lock: undefined }));
        setFocusConsultaRecord({});
        return;
      }
      setEmpresa((prev) => ({ ...prev, ...patch }));
    },
    [empresa, endereco, representanteLegal, setup.focus_cnpj_lock],
  );

  const handleValidarCnpj = useCallback(async () => {
    const digits = unmask(empresa.cnpj_cpf ?? "");
    if (digits.length !== 14) {
      toast.error("Informe o CNPJ completo (14 dígitos) antes de validar.");
      return;
    }
    setCnpjValidating(true);
    try {
      const res = await consultarCnpjNaFocus(digits);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const applied = applyFocusCnpjConsulta(res.data, empresa.nome_fantasia);
      const raw = buildFocusCnpjConsultaRecord(res.data);
      setFocusConsultaRecord(raw);
      const nextEmpresa = { ...empresa, ...applied.empresa, cnpj_cpf: digits };
      const nextEndereco = { ...endereco, ...applied.endereco };
      const nextRep = { ...representanteLegal, ...applied.representante };
      const nextSetup = mergeSetupPatch(setup, {
        focus_cnpj_lock: applied.lock,
      });
      setEmpresa(nextEmpresa);
      setEndereco(nextEndereco);
      setRepresentanteLegal(nextRep);
      setSetup(nextSetup);
      if (companyId) {
        const patchRes = await patchCompanyMaps(companyId, {
          empresa: {
            ...nextEmpresa,
            telefone: (nextEmpresa.telefone ?? "").replace(/\D/g, ""),
          },
          endereco_principal: nextEndereco,
          representante_legal: nextRep,
          focus_cnpj_consulta: raw,
          setup: nextSetup,
          document: digits,
        });
        if (patchRes.error) {
          toast.error(patchRes.error);
          return;
        }
      }
      toast.success(
        "CNPJ validado. Dados da empresa e endereço foram preenchidos.",
      );
    } finally {
      setCnpjValidating(false);
    }
  }, [empresa, endereco, representanteLegal, setup, companyId]);

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
        representante_legal: representanteLegal,
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
    if (createNewGroup && !groupName.trim()) {
      setStepError("Informe o nome do grupo.");
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
    const certOut = {
      status: "valid" as const,
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
            representante_legal: representanteLegal,
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
            representante_legal: representanteLegal,
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
      representante_legal: representanteLegal,
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

    if (activeStep === 1) {
      if (!companyId) {
        if (!runAdvanceStep1Local()) return;
        setActiveStep(2);
        return;
      }
      const ok = await runStep1Patch();
      if (ok) setActiveStep(2);
      return;
    }

    if (activeStep === 2) {
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
        if (
          !isStep3CertificatePayloadComplete(setup.certificate, {
            certBase64: certFileBase64,
            certPassword,
          })
        ) {
          setStepError(
            "Envie o certificado A1 (PFX/P12), informe a senha e aguarde o carregamento em base64.",
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
        setActiveStep(3);
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
      setActiveStep(3);
      return;
    }

    if (activeStep === 3) {
      if (!companyId) {
        toast.error("Conclua o certificado para criar a unidade.");
        return;
      }
      const ep = setup.epoc ?? { mode: "undecided" as const };
      setSaving(true);
      if (ep.mode === "credentials") {
        const u = (ep.username ?? "").trim();
        const enabled = ep.enabled ?? false;
        const pwdInput = (ep.password ?? "").trim();
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
          ep.password_on_server &&
          existingRow?.settings
        ) {
          const prev = parseEpocSettings(
            existingRow.settings as Record<string, unknown>,
          );
          if (prev.password) pwdFinal = prev.password;
        }

        if (u && (!enabled || pwdFinal)) {
          const settings: EpocIntegrationSettings = {
            username: u,
            base_url: (ep.base_url ?? "").trim() || undefined,
            codigo_filial: (ep.codigo_filial ?? "").trim() || undefined,
            ambiente: ep.ambiente ?? "producao",
          };
          if (pwdFinal) settings.password = pwdFinal;

          const merged = mergeEpocSettingsForUpsert(
            existingRow?.settings as Record<string, unknown> | undefined,
            settings,
          );

          await supabase.from("company_integrations").upsert(
            {
              company_id: companyId,
              provider: "epoc",
              enabled,
              settings: merged,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "company_id,provider" },
          );
          if (enabled && (ep.base_url ?? "").trim()) {
            triggerEpocCsvSyncInBackground(companyId, {
              sync_mode: "onboarding_initial",
            });
            toast.message(
              "Sincronização EPOC em segundo plano: período desde o início do mês anterior até hoje.",
              { duration: 5500 },
            );
          }
        }
      }
      const nextSetup = syncCompletionState(
        mergeSetupPatch(setup, { current_step: 3, epoc: ep }),
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
    await patchCompanyMaps(companyId, { setup: completed });
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
    if (lockStepsOneToTwo && target >= 1 && target <= 2) {
      toast.message(
        "Após criar a unidade com sucesso, não é possível voltar aos passos Empresa ou Certificado.",
      );
      return;
    }
    setActiveStep((s) => s - 1);
  };

  const goToStep = useCallback(
    (step: SetupStepNumber) => {
      if (step < 1 || step > 3) return;
      if (step > 1 && !companyId && step > 2) return;
      if (lockStepsOneToTwo && step >= 1 && step <= 2) {
        toast.message(
          "Após criar a unidade com sucesso, não é possível voltar aos passos Empresa ou Certificado.",
        );
        return;
      }
      setStepError(null);
      setActiveStep(step);
    },
    [companyId, lockStepsOneToTwo],
  );

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
      const certStateBase = {
        status: "uploaded" as const,
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
              {setup.certificate?.status === "valid"
                ? `Válido até ${focusnfe.certificado_validade ?? "—"}`
                : (setup.certificate?.status ?? "não enviado")}
            </p>
          </div>
          <div>
            <p className="font-medium">PDV</p>
            <p className="text-muted-foreground">
              {setup.epoc?.mode === "no"
                ? "Sem integração"
                : setup.epoc?.mode === "credentials"
                  ? setup.epoc?.enabled
                    ? "Integração ativa"
                    : "Credenciais salvas (inativa)"
                  : (setup.epoc?.mode ?? "—")}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Notas fiscais (XML/ZIP) podem ser importadas depois na página{" "}
              Importações.
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

  const stepKey = (
    activeStep >= 1 && activeStep <= 3 ? activeStep : 1
  ) as SetupStepNumber;

  const wizardBody = (
    <>
      <PageHeader
        title="Configurar unidade"
        description={SETUP_STEP_HINTS[stepKey]}
        icon={Building2}
        className={isModal ? "pb-1" : undefined}
      />

      <SetupStepper
        activeStep={activeStep}
        setup={setup}
        companyId={companyId}
        lockStepsOneToTwo={lockStepsOneToTwo}
        onStepClick={goToStep}
      />

      {stepError ? (
        <p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          {stepError}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm">
        <div className="border-b border-border/60 bg-muted/20 px-4 py-3 sm:px-6 sm:py-3.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Etapa {activeStep} de 3
          </p>
          <h2 className="text-base font-semibold leading-snug sm:text-lg">
            {SETUP_STEP_LABELS[stepKey]}
          </h2>
        </div>
        <div className="p-4 sm:p-6">
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
              onEmpresaChange={applyEmpresaPatch}
              lockedEmpresaKeys={setup.focus_cnpj_lock?.locked_empresa_keys}
              cnpjValidating={cnpjValidating}
              onValidarCnpj={() => void handleValidarCnpj()}
              cnpjValidated={
                !!setup.focus_cnpj_lock?.validated_cnpj_digits &&
                setup.focus_cnpj_lock.validated_cnpj_digits ===
                  unmask(empresa.cnpj_cpf ?? "")
              }
            />
          ) : null}
          {activeStep === 2 ? (
            <StepCertificateForm
              companyId={companyId}
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
              busy={certBusy}
            />
          ) : null}
          {activeStep === 3 ? (
            <StepPdvForm
              epoc={setup.epoc}
              onEpocChange={(patch) =>
                setSetup((s) =>
                  mergeSetupPatch(s, {
                    epoc: { ...(s.epoc ?? { mode: "undecided" }), ...patch },
                  }),
                )
              }
            />
          ) : null}
        </div>
      </div>

      <div
        className={cn(
          "flex flex-col-reverse gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center sm:pt-5",
          activeStep > 2 ? "sm:justify-between" : "sm:justify-end",
        )}
      >
        {activeStep > 2 ? (
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
            onClick={activeStep === 1 ? () => exitApp() : handleBack}
            disabled={saving || (lockStepsOneToTwo && activeStep === 3)}
          >
            {activeStep === 1 ? "Cancelar" : "Voltar"}
          </Button>
          <Button
            type="button"
            className="w-full min-w-32 sm:w-auto"
            onClick={() => void handleNext()}
            disabled={saving || certBusy}
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Salvando…
              </>
            ) : activeStep === 3 ? (
              "Concluir"
            ) : (
              "Continuar"
            )}
          </Button>
        </div>
      </div>
    </>
  );

  return isModal ? (
    <div className="space-y-5">{wizardBody}</div>
  ) : (
    <PageShell className="max-w-2xl space-y-6">{wizardBody}</PageShell>
  );
}
