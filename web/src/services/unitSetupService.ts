import { supabase } from "@/lib/supabase";
import { calculateSetupProgress, mergeSetupPatch } from "@/lib/setup/setupProgress";
import type {
  CompanySetupMap,
  EmpresaMap,
  EnderecoPrincipalMap,
  FocusNfeMap,
} from "@/types/companySetup";
import type { Company } from "@/contexts/CompanyContext";

export const EMPTY_SETUP_BASE: CompanySetupMap = {
  status: "not_started",
  current_step: 1,
  completed_steps: [],
  skipped_steps: [],
  progress_percent: 0,
  certificate: { status: "not_sent" },
  xml_zip_import: { phase: "idle", file_log: [] },
  epoc: { mode: "undecided" },
};

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

export type CreateUnitStep1NewGroup = {
  mode: "new_group";
  ownerUserId: string;
  groupName: string;
  empresa: EmpresaMap;
};

export type CreateUnitStep1ExistingGroup = {
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

  const setup = mergeSetupPatch(initialSetupMap(), {
    status: "in_progress",
    current_step: 2,
    completed_steps: [1],
    last_paused_at: undefined,
    updated_at: nowIso(),
  });

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
    endereco_principal: {},
    focusnfe: {},
    setup: setup as unknown as Record<string, unknown>,
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

export async function fetchCompanySetupRow(
  companyId: string,
): Promise<
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
  return { company: data as Company & {
    empresa: Record<string, unknown>;
    endereco_principal: Record<string, unknown>;
    focusnfe: Record<string, unknown>;
    setup: Record<string, unknown>;
  } };
}

export async function patchCompanyMaps(
  companyId: string,
  patch: {
    empresa?: EmpresaMap;
    endereco_principal?: EnderecoPrincipalMap;
    focusnfe?: FocusNfeMap;
    setup?: Partial<CompanySetupMap>;
    /** Espelho legível */
    name?: string;
    document?: string | null;
    email?: string | null;
    phone?: string | null;
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
  if (patch.focusnfe !== undefined)
    row.focusnfe = patch.focusnfe as unknown as Record<string, unknown>;
  if (patch.setup !== undefined) {
    row.setup = patch.setup as unknown as Record<string, unknown>;
  }
  if (patch.name !== undefined) row.name = patch.name;
  if (patch.document !== undefined) row.document = patch.document;
  if (patch.email !== undefined) row.email = patch.email;
  if (patch.phone !== undefined) row.phone = patch.phone;

  const { error } = await supabase.from("companies").update(row).eq("id", companyId);
  return { error: error?.message };
}

export function normalizeSetupMap(raw: unknown): CompanySetupMap {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const base: CompanySetupMap = {
    status: (o.status as CompanySetupMap["status"]) ?? "not_started",
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
    completed_at: typeof o.completed_at === "string" ? o.completed_at : undefined,
    last_paused_at:
      typeof o.last_paused_at === "string" ? o.last_paused_at : undefined,
    certificate: o.certificate as CompanySetupMap["certificate"],
    xml_zip_import: o.xml_zip_import as CompanySetupMap["xml_zip_import"],
    epoc: o.epoc as CompanySetupMap["epoc"],
  };
  base.progress_percent = calculateSetupProgress(base);
  if (!base.certificate) base.certificate = { status: "not_sent" };
  if (!base.xml_zip_import) {
    base.xml_zip_import = { phase: "idle", file_log: [] };
  }
  if (!base.epoc) base.epoc = { mode: "undecided" };
  return base;
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
