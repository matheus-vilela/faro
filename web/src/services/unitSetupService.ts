import type { Company } from "@/contexts/CompanyContext";
import { stripFocusnfeSecrets } from "@/lib/focusNfeSanitize";
import {
  calculateSetupProgress,
  mergeSetupPatch,
} from "@/lib/setup/setupProgress";
import { defaultOnboardingFiscalRecord } from "@/lib/onboardingFiscalDefaults";
import { defaultOnboardingPdvRecord } from "@/lib/onboardingPdvDefaults";
import { supabase } from "@/lib/supabase";
import type { CompanyNotificationEntry } from "@/types/companyNotification";
import type {
  CompanySetupMap,
  EmpresaMap,
  EnderecoPrincipalMap,
  FocusNfeMap,
  SetupEpocState,
} from "@/types/companySetup";

export const EMPTY_SETUP_BASE: CompanySetupMap = {
  status: "not_started",
  setup_schema_version: 6,
  current_step: 1,
  completed_steps: [],
  skipped_steps: [],
  progress_percent: 0,
  certificate: { status: "not_sent" },
  xml_zip_import: { phase: "idle", file_log: [] },
  epoc: { mode: "undecided" },
};

/**
 * Converte o modelo de 5 etapas (com endereço) para 4 (endereço só via consulta CNPJ).
 * Antigo: 1=emp, 2=end, 3=cert, 4=xml, 5=PDV. Novo (v4): 1=emp, 2=cert, 3=PDV, 4=xml.
 */
function migrateFromFiveToFourStep(setup: CompanySetupMap): CompanySetupMap {
  if ((setup.setup_schema_version ?? 0) >= 3) return setup;
  const cs = setup.completed_steps ?? [];
  const sk = setup.skipped_steps ?? [];
  const mapOldToNew = (o: number): number | null => {
    if (o < 1 || o > 5) return null;
    if (o === 1) return 1;
    if (o === 2) return null; // endereço
    if (o === 3) return 2;
    if (o === 4) return 4;
    if (o === 5) return 3;
    return null;
  };
  const newCompleted = [
    ...new Set(cs.map(mapOldToNew).filter((n): n is number => n != null)),
  ].sort((a, b) => a - b);
  const newSkipped = [
    ...new Set(sk.map(mapOldToNew).filter((n): n is number => n != null)),
  ].sort((a, b) => a - b);
  const cur = setup.current_step ?? 1;
  let newCur = cur;
  if (cur <= 1) newCur = 1;
  else if (cur === 2)
    newCur = 2; // fim de empresa ou início de cert. no novo
  else if (cur === 3) newCur = 2;
  else if (cur === 4) newCur = 4;
  else if (cur === 5) newCur = 3;
  else if (cur >= 6) newCur = 5;
  return mergeSetupPatch(setup, {
    completed_steps: newCompleted,
    skipped_steps: newSkipped,
    current_step: Math.min(5, Math.max(1, newCur)),
    setup_schema_version: 4,
  });
}

/** Reordena esquema v3: 3=XML/ZIP,4=PDV -> v4: 3=PDV,4=XML/ZIP. */
function migrateFromThreeOrderToFour(setup: CompanySetupMap): CompanySetupMap {
  const remap = (arr: number[]): number[] => {
    const out = new Set<number>();
    for (const step of arr) {
      if (step === 3) out.add(4);
      else if (step === 4) out.add(3);
      else out.add(step);
    }
    return [...out].sort((a, b) => a - b);
  };
  const cur = setup.current_step ?? 1;
  const newCur = cur === 3 ? 4 : cur === 4 ? 3 : cur;
  return mergeSetupPatch(setup, {
    completed_steps: remap(setup.completed_steps ?? []),
    skipped_steps: remap(setup.skipped_steps ?? []),
    current_step: Math.min(5, Math.max(1, newCur)),
    setup_schema_version: 4,
  });
}

/**
 * v5: onboarding com 3 passos apenas (sem XML/ZIP no wizard).
 * Remove o passo 4 do progresso e reencaminha estados «no XML» para o último passo válido (3).
 */
function migrateWizardFourToThreeStepsOnly(
  setup: CompanySetupMap,
): CompanySetupMap {
  if ((setup.setup_schema_version ?? 0) >= 5) return setup;
  const completed = [
    ...new Set((setup.completed_steps ?? []).filter((s) => s !== 4)),
  ].sort((a, b) => a - b);
  const skipped = [
    ...new Set((setup.skipped_steps ?? []).filter((s) => s !== 4)),
  ].sort((a, b) => a - b);
  let cur = setup.current_step ?? 1;
  if (setup.status !== "completed" && cur >= 4) cur = 3;
  if (setup.status === "completed" && cur > 3) cur = 3;
  return mergeSetupPatch(setup, {
    completed_steps: completed,
    skipped_steps: skipped,
    current_step: Math.max(1, Math.min(cur, 3)),
    setup_schema_version: 5,
  });
}

/**
 * v6: quarto passo WhatsApp no wizard.
 * Setups já concluídos antes desta versão têm o passo 4 marcado como skipped.
 */
function migrateWizardThreeToFourWithWhatsapp(
  setup: CompanySetupMap,
): CompanySetupMap {
  if ((setup.setup_schema_version ?? 0) >= 6) return setup;
  const skipped = [...new Set(setup.skipped_steps ?? [])];
  if (setup.status === "completed" && !skipped.includes(4)) {
    skipped.push(4);
    skipped.sort((a, b) => a - b);
  }
  return mergeSetupPatch(setup, {
    skipped_steps: skipped,
    setup_schema_version: 6,
  });
}

/** Converte progresso do assistente antigo (6 etapas) para o atual (5 etapas). */
function migrateLegacySixStepWizardSetup(
  setup: CompanySetupMap,
): CompanySetupMap {
  const cs = setup.completed_steps ?? [];
  const sk = setup.skipped_steps ?? [];
  const remap = (arr: number[]): number[] => {
    const s = new Set<number>();
    for (const o of arr) {
      if (typeof o !== "number" || o < 1) continue;
      if (o <= 2) s.add(o);
      else if (o === 3) continue;
      else if (o <= 6) s.add(o - 1);
    }
    return [...s].sort((a, b) => a - b);
  };
  const cur = setup.current_step ?? 1;
  let newCur = cur;
  if (cur <= 2) newCur = cur;
  else if (cur === 3) newCur = 3;
  else if (cur >= 4 && cur <= 6) newCur = cur - 1;
  else if (cur >= 7) newCur = 6;
  return mergeSetupPatch(setup, {
    completed_steps: remap(cs),
    skipped_steps: remap(sk),
    current_step: Math.min(5, Math.max(1, newCur)),
    setup_schema_version: 2,
  });
}

function nowIso() {
  return new Date().toISOString();
}

export function initialSetupMap(): CompanySetupMap {
  return {
    ...EMPTY_SETUP_BASE,
    started_at: nowIso(),
    updated_at: nowIso(),
  };
}

type CreateUnitStep1Maps = {
  endereco_principal?: EnderecoPrincipalMap;
  /** Snapshot bruto retornado pela edge `focus-consulta-cnpj`. */
  focus_cnpj_consulta?: Record<string, unknown>;
  /** Mesclado no `setup` inicial (ex.: `focus_cnpj_lock`, certificado após passo 3). */
  setupExtension?: Partial<CompanySetupMap>;
  /**
   * Quando true, a linha só é criada após sucesso em `focus-cria-empresa` (empresa + cert).
   * `setup` inicia em `current_step: 3` (PDV) e `completed_steps: [1,2]`.
   */
  afterFocusCriaSuccess?: boolean;
  /** Dados Focus em `companies.focusnfe` (sem certificado em base64 nem senha). */
  focusnfe?: FocusNfeMap;
};

export type CreateUnitStep1NewGroup = CreateUnitStep1Maps & {
  mode: "new_group";
  ownerUserId: string;
  groupName: string;
  empresa: EmpresaMap;
};

export type CreateUnitStep1ExistingGroup = CreateUnitStep1Maps & {
  mode: "existing_group";
  ownerUserId: string;
  groupId: string;
  empresa: EmpresaMap;
};

export async function createCompanyFromSetupStep1(
  input: CreateUnitStep1NewGroup | CreateUnitStep1ExistingGroup,
): Promise<{ companyId: string } | { error: string }> {
  const companyId = crypto.randomUUID();
  const e = input.empresa;
  const docDigits = (e.cnpj_cpf ?? "").replace(/\D/g, "");
  const displayName =
    (e.nome_fantasia ?? "").trim() || (e.nome_razao_social ?? "").trim();
  const phoneDigits = (e.telefone ?? "").replace(/\D/g, "");

  let groupId: string;
  if (input.mode === "new_group") {
    groupId = crypto.randomUUID();
    const { error: gErr } = await supabase.from("company_groups").insert({
      id: groupId,
      name: input.groupName.trim() || "Default",
      owner_user_id: input.ownerUserId,
    });
    if (gErr) return { error: gErr.message };
  } else {
    groupId = input.groupId;
  }

  const afterFocus = input.afterFocusCriaSuccess === true;
  let setup = mergeSetupPatch(initialSetupMap(), {
    status: "in_progress",
    current_step: afterFocus ? 3 : 2,
    completed_steps: afterFocus ? [1, 2] : [1],
    last_paused_at: undefined,
    updated_at: nowIso(),
  });
  if (input.setupExtension) {
    setup = mergeSetupPatch(setup, input.setupExtension);
  }
  const empresaPayload: EmpresaMap = {
    ...e,
    cnpj_cpf: docDigits,
    telefone: phoneDigits,
  };

  const { error: cErr } = await supabase.from("companies").insert({
    id: companyId,
    group_id: groupId,
    name: displayName,
    document: docDigits,
    email: (e.email ?? "").trim() || null,
    phone: phoneDigits || null,
    empresa: empresaPayload as unknown as Record<string, unknown>,
    endereco_principal: (input.endereco_principal ?? {}) as unknown as Record<
      string,
      unknown
    >,
    focus_cnpj_consulta: (input.focus_cnpj_consulta ?? {}) as unknown as Record<
      string,
      unknown
    >,
    focusnfe: stripFocusnfeSecrets(input.focusnfe ?? {}) as unknown as Record<
      string,
      unknown
    >,
    setup: setup as unknown as Record<string, unknown>,
    onboarding_fiscal: defaultOnboardingFiscalRecord(),
    onboarding_pdv: defaultOnboardingPdvRecord(),
  });
  if (cErr) return { error: cErr.message };

  const { error: uErr } = await supabase.from("user_companies").insert({
    user_id: input.ownerUserId,
    company_id: companyId,
    role: "owner",
  });
  if (uErr) return { error: uErr.message };

  return { companyId };
}

export async function fetchCompanySetupRow(companyId: string): Promise<
  | {
      company: Company & {
        empresa: Record<string, unknown>;
        endereco_principal: Record<string, unknown>;
        focusnfe: Record<string, unknown>;
        setup: Record<string, unknown>;
      };
    }
  | { error: string }
> {
  const { data, error } = await supabase
    .from("companies")
    .select("*")
    .eq("id", companyId)
    .single();
  if (error || !data) return { error: error?.message ?? "Não encontrado" };
  return {
    company: data as Company & {
      empresa: Record<string, unknown>;
      endereco_principal: Record<string, unknown>;
      focusnfe: Record<string, unknown>;
      setup: Record<string, unknown>;
    },
  };
}

export async function patchCompanyMaps(
  companyId: string,
  patch: {
    empresa?: EmpresaMap;
    endereco_principal?: EnderecoPrincipalMap;
    focus_cnpj_consulta?: Record<string, unknown>;
    focusnfe?: FocusNfeMap;
    setup?: Partial<CompanySetupMap>;
    /** Espelho legível */
    name?: string;
    document?: string | null;
    email?: string | null;
    phone?: string | null;
    onboarding_pdv?: Record<string, unknown>;
    onboarding_fiscal?: Record<string, unknown>;
    notification?: CompanyNotificationEntry[];
  },
): Promise<{ error?: string }> {
  const row: Record<string, unknown> = {};
  if (patch.empresa !== undefined)
    row.empresa = patch.empresa as unknown as Record<string, unknown>;
  if (patch.endereco_principal !== undefined)
    row.endereco_principal = patch.endereco_principal as unknown as Record<
      string,
      unknown
    >;
  if (patch.focus_cnpj_consulta !== undefined)
    row.focus_cnpj_consulta = patch.focus_cnpj_consulta;
  if (patch.focusnfe !== undefined)
    row.focusnfe = stripFocusnfeSecrets(patch.focusnfe) as unknown as Record<
      string,
      unknown
    >;
  if (patch.setup !== undefined) {
    row.setup = patch.setup as unknown as Record<string, unknown>;
  }
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.document !== undefined) row.document = patch.document;
  if (patch.email !== undefined) row.email = patch.email;
  if (patch.phone !== undefined) row.phone = patch.phone;
  if (patch.onboarding_fiscal !== undefined) {
    row.onboarding_fiscal = patch.onboarding_fiscal;
  }
  if (patch.onboarding_pdv !== undefined) {
    row.onboarding_pdv = patch.onboarding_pdv;
  }
  if (patch.notification !== undefined) {
    row.notification = patch.notification;
  }

  const { error } = await supabase
    .from("companies")
    .update(row)
    .eq("id", companyId);
  return { error: error?.message };
}

export function normalizeSetupMap(raw: unknown): CompanySetupMap {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const base: CompanySetupMap = {
    status: (o.status as CompanySetupMap["status"]) ?? "not_started",
    setup_schema_version:
      typeof o.setup_schema_version === "number"
        ? o.setup_schema_version
        : undefined,
    current_step: typeof o.current_step === "number" ? o.current_step : 1,
    completed_steps: Array.isArray(o.completed_steps)
      ? (o.completed_steps as number[])
      : [],
    skipped_steps: Array.isArray(o.skipped_steps)
      ? (o.skipped_steps as number[])
      : [],
    progress_percent:
      typeof o.progress_percent === "number" ? o.progress_percent : 0,
    started_at: typeof o.started_at === "string" ? o.started_at : undefined,
    updated_at: typeof o.updated_at === "string" ? o.updated_at : undefined,
    completed_at:
      typeof o.completed_at === "string" ? o.completed_at : undefined,
    last_paused_at:
      typeof o.last_paused_at === "string" ? o.last_paused_at : undefined,
    focus_cnpj_lock: o.focus_cnpj_lock as CompanySetupMap["focus_cnpj_lock"],
    certificate: o.certificate as CompanySetupMap["certificate"],
    xml_zip_import: o.xml_zip_import as CompanySetupMap["xml_zip_import"],
    epoc: o.epoc as CompanySetupMap["epoc"],
    item_classification_onboarding: o.item_classification_onboarding as
      | CompanySetupMap["item_classification_onboarding"]
      | undefined,
  };
  if (!base.certificate) base.certificate = { status: "not_sent" };
  if (!base.xml_zip_import) {
    base.xml_zip_import = { phase: "idle", file_log: [] };
  }
  if (!base.epoc) base.epoc = { mode: "undecided" };
  const ep = base.epoc as SetupEpocState & {
    mode?: string;
    excel_storage_path?: string;
  };
  if (String(ep.mode) === "excel") {
    base.epoc = {
      mode: "undecided",
      enabled: ep.enabled,
      username: ep.username,
      password: ep.password,
      base_url: ep.base_url,
      codigo_filial: ep.codigo_filial,
      ambiente: ep.ambiente,
      password_on_server: ep.password_on_server,
      updated_at: ep.updated_at,
    };
  }
  const version = base.setup_schema_version ?? 0;
  let migrated = version < 2 ? migrateLegacySixStepWizardSetup(base) : base;
  if ((migrated.setup_schema_version ?? 0) < 3) {
    migrated = migrateFromFiveToFourStep(migrated);
  }
  if ((migrated.setup_schema_version ?? 0) < 4) {
    migrated = migrateFromThreeOrderToFour(migrated);
  }
  if ((migrated.setup_schema_version ?? 0) < 5) {
    migrated = migrateWizardFourToThreeStepsOnly(migrated);
  }
  if ((migrated.setup_schema_version ?? 0) < 6) {
    migrated = migrateWizardThreeToFourWithWhatsapp(migrated);
  }
  migrated.progress_percent = calculateSetupProgress(migrated);
  return migrated;
}

export function buildPausedSetup(current: CompanySetupMap): CompanySetupMap {
  return mergeSetupPatch(current, {
    status: "paused",
    last_paused_at: nowIso(),
    updated_at: nowIso(),
  });
}

export function buildCompletedSetup(
  current: CompanySetupMap,
  opts: { allApplicableDone: boolean },
): CompanySetupMap {
  const next = mergeSetupPatch(current, {
    status: opts.allApplicableDone ? "completed" : "in_progress",
    completed_at: opts.allApplicableDone ? nowIso() : current.completed_at,
    updated_at: nowIso(),
  });
  return next;
}
