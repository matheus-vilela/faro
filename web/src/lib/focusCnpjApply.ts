import type { FocusCnpjConsultaData } from "@/types/focusCnpjConsulta";
import type {
  EmpresaMap,
  EnderecoPrincipalMap,
  FocusCnpjLockState,
  RepresentanteLegalMap,
} from "@/types/companySetup";

function str(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

function bool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  return undefined;
}

/** Monta registro completo para `companies.focus_cnpj_consulta` (campos mínimos + extras da API). */
export function buildFocusCnpjConsultaRecord(
  data: FocusCnpjConsultaData,
): Record<string, unknown> {
  const end = data.endereco ?? {};
  const base: Record<string, unknown> = {
    cnpj: str(data.cnpj),
    razao_social: str(data.razao_social),
    situacao_cadastral: str(data.situacao_cadastral),
    cnae_principal: str(data.cnae_principal),
    optante_simples_nacional: data.optante_simples_nacional,
    optante_mei: data.optante_mei,
    endereco: {
      codigo_municipio: str(end.codigo_municipio),
      codigo_siafi: str(end.codigo_siafi),
      codigo_ibge: str(end.codigo_ibge),
      nome_municipio: str(end.nome_municipio),
      logradouro: str(end.logradouro),
      complemento:
        end.complemento === "" || end.complemento == null
          ? end.complemento
          : str(end.complemento),
      numero: str(end.numero),
      bairro: str(end.bairro),
      cep: str(end.cep),
      uf: str(end.uf),
    },
    nome_responsavel: str(data.nome_responsavel),
    cpf_responsavel: str(data.cpf_responsavel),
    data_nascimento: str(data.data_nascimento),
  };
  const merged: Record<string, unknown> = { ...data, ...base };
  return merged;
}

export type AppliedFocusCnpjResult = {
  empresa: EmpresaMap;
  endereco: EnderecoPrincipalMap;
  representante: RepresentanteLegalMap;
  lock: FocusCnpjLockState;
};

/**
 * Aplica retorno da consulta CNPJ nos maps e define quais chaves ficam bloqueadas (preenchidas pela API).
 */
export function applyFocusCnpjConsulta(
  data: FocusCnpjConsultaData,
  currentFantasia: string | undefined,
): AppliedFocusCnpjResult {
  const cnpjDigits = (data.cnpj ?? "").replace(/\D/g, "").slice(0, 14);
  const lockEmpresa: string[] = [];
  const lockEndereco: string[] = [];
  const lockRep: string[] = [];

  const empresa: EmpresaMap = {};
  if (data.razao_social != null && String(data.razao_social).trim()) {
    empresa.nome_razao_social = String(data.razao_social).trim();
    lockEmpresa.push("nome_razao_social");
  }
  if (cnpjDigits.length === 14) {
    empresa.cnpj_cpf = cnpjDigits;
    // CNPJ não entra em lock — usuário pode alterar para nova validação
  }
  if (data.situacao_cadastral != null && String(data.situacao_cadastral).trim()) {
    empresa.situacao_cadastral = String(data.situacao_cadastral).trim();
    lockEmpresa.push("situacao_cadastral");
  }
  if (data.cnae_principal != null && String(data.cnae_principal).trim()) {
    empresa.cnae_principal = String(data.cnae_principal).trim();
    lockEmpresa.push("cnae_principal");
  }
  const optSn = bool(data.optante_simples_nacional);
  const optMei = bool(data.optante_mei);
  if (optSn !== undefined) {
    empresa.optante_simples_nacional = optSn;
    lockEmpresa.push("optante_simples_nacional");
  }
  if (optMei !== undefined) {
    empresa.optante_mei = optMei;
    lockEmpresa.push("optante_mei");
  }
  if (optSn !== undefined || optMei !== undefined) {
    if (optMei === true || optSn === true) {
      empresa.regime_tributario = 1;
      lockEmpresa.push("regime_tributario");
    } else if (optSn === false && optMei === false) {
      empresa.regime_tributario = 2;
      lockEmpresa.push("regime_tributario");
    }
  }
  const lockEmpresaUnique = [...new Set(lockEmpresa)];
  lockEmpresa.length = 0;
  lockEmpresa.push(...lockEmpresaUnique);

  if ((currentFantasia ?? "").trim()) {
    empresa.nome_fantasia = currentFantasia.trim();
  }

  const endereco: EnderecoPrincipalMap = {};
  const en = data.endereco;
  if (en) {
    const setEnd = (key: keyof EnderecoPrincipalMap, val: string) => {
      (endereco as Record<string, string>)[key as string] = val;
      lockEndereco.push(key as string);
    };
    if (en.cep != null && String(en.cep).replace(/\D/g, "").length >= 8) {
      setEnd("cep", String(en.cep).replace(/\D/g, "").slice(0, 8));
    }
    if (en.logradouro != null && str(en.logradouro)) setEnd("logradouro", str(en.logradouro)!);
    if (en.numero != null && str(en.numero) !== undefined)
      setEnd("numero", str(en.numero)!);
    if (en.complemento !== undefined) {
      setEnd("complemento", str(en.complemento) ?? "");
    }
    if (en.bairro != null && str(en.bairro)) setEnd("bairro", str(en.bairro)!);
    if (en.nome_municipio != null && str(en.nome_municipio))
      setEnd("municipio", str(en.nome_municipio)!);
    if (en.uf != null && str(en.uf)) setEnd("uf", str(en.uf)!.toUpperCase().slice(0, 2));
    if (en.codigo_ibge != null && str(en.codigo_ibge))
      setEnd("ibge_cidade", str(en.codigo_ibge)!);
    if (en.codigo_municipio != null && str(en.codigo_municipio))
      setEnd("codigo_municipio", str(en.codigo_municipio)!);
    if (en.codigo_siafi != null && str(en.codigo_siafi))
      setEnd("codigo_siafi", str(en.codigo_siafi)!);
  }
  const lockEnderecoUnique = [...new Set(lockEndereco)];
  lockEndereco.length = 0;
  lockEndereco.push(...lockEnderecoUnique);

  const representante: RepresentanteLegalMap = {};
  if (data.nome_responsavel != null && String(data.nome_responsavel).trim()) {
    representante.nome_responsavel = String(data.nome_responsavel).trim();
    lockRep.push("nome_responsavel");
  }
  if (data.cpf_responsavel != null) {
    const cpf = String(data.cpf_responsavel).replace(/\D/g, "").slice(0, 11);
    if (cpf.length === 11) {
      representante.cpf_responsavel = cpf;
      lockRep.push("cpf_responsavel");
    }
  }
  if (data.data_nascimento != null && String(data.data_nascimento).trim()) {
    representante.data_nascimento = normalizeApiDateToIso(
      String(data.data_nascimento).trim(),
    );
    if (representante.data_nascimento) lockRep.push("data_nascimento");
  }

  const lock: FocusCnpjLockState = {
    validated_cnpj_digits: cnpjDigits.length === 14 ? cnpjDigits : "",
    locked_empresa_keys: lockEmpresa,
    locked_endereco_keys: lockEndereco,
    locked_representante_keys: [...new Set(lockRep)],
    validated_at: new Date().toISOString(),
  };

  return { empresa, endereco, representante, lock };
}

/**
 * Reconstrói `FocusCnpjLockState` a partir do JSON `focus_cnpj_consulta` salvo no banco.
 * Usado ao retomar o setup quando `setup.focus_cnpj_lock` não veio persistido ou está incompleto.
 */
export function deriveFocusCnpjLockFromStoredConsulta(
  consulta: Record<string, unknown> | null | undefined,
  currentCnpjDigits: string,
): FocusCnpjLockState | undefined {
  if (!consulta || typeof consulta !== "object") return undefined;
  const d = (currentCnpjDigits ?? "").replace(/\D/g, "").slice(0, 14);
  const snap = String(consulta.cnpj ?? "").replace(/\D/g, "").slice(0, 14);
  if (d.length !== 14 || snap.length !== 14 || snap !== d) return undefined;

  const endRaw = consulta.endereco;
  const en =
    endRaw && typeof endRaw === "object"
      ? (endRaw as Record<string, unknown>)
      : null;

  const data: FocusCnpjConsultaData = {
    razao_social: str(consulta.razao_social),
    cnpj: snap,
    situacao_cadastral: str(consulta.situacao_cadastral),
    cnae_principal: str(consulta.cnae_principal),
    optante_simples_nacional: bool(consulta.optante_simples_nacional),
    optante_mei: bool(consulta.optante_mei),
    endereco: en
      ? {
          codigo_municipio: str(en.codigo_municipio),
          codigo_siafi: str(en.codigo_siafi),
          codigo_ibge: str(en.codigo_ibge),
          nome_municipio: str(en.nome_municipio),
          logradouro: str(en.logradouro),
          complemento:
            en.complemento === "" || en.complemento == null
              ? (en.complemento as string | undefined)
              : str(en.complemento),
          numero: str(en.numero),
          bairro: str(en.bairro),
          cep: str(en.cep),
          uf: str(en.uf),
        }
      : undefined,
    nome_responsavel: str(consulta.nome_responsavel),
    cpf_responsavel: str(consulta.cpf_responsavel),
    data_nascimento: str(consulta.data_nascimento),
  };

  const { lock } = applyFocusCnpjConsulta(data, "");
  if (!lock.validated_cnpj_digits) return undefined;
  return lock;
}

/**
 * Define o lock ao reabrir o wizard: prioriza reconstrução a partir de `focus_cnpj_consulta`
 * (garante bloqueios alinhados ao snapshot da API); se não houver snapshot válido, usa o lock já salvo em `setup`.
 */
export function resolveFocusCnpjLockForResume(
  setupLock: FocusCnpjLockState | undefined,
  consulta: Record<string, unknown> | null | undefined,
  currentCnpjDigits: string,
): FocusCnpjLockState | undefined {
  const d = (currentCnpjDigits ?? "").replace(/\D/g, "").slice(0, 14);
  const derived = deriveFocusCnpjLockFromStoredConsulta(consulta, d);
  if (derived) return derived;
  if (setupLock?.validated_cnpj_digits === d && d.length === 14) return setupLock;
  return undefined;
}

/** Converte data da API (YYYY-MM-DD ou DD/MM/YYYY) para YYYY-MM-DD. */
export function normalizeApiDateToIso(raw: string): string | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const digits = t.replace(/\D/g, "");
  if (digits.length === 8) {
    return `${digits.slice(4, 8)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`;
  }
  return undefined;
}

/** Remove dos maps os valores cujas chaves estavam bloqueadas pela consulta anterior. */
export function clearFocusCnpjFilledFields(
  empresa: EmpresaMap,
  endereco: EnderecoPrincipalMap,
  representante: RepresentanteLegalMap,
  lock: FocusCnpjLockState | undefined,
): {
  empresa: EmpresaMap;
  endereco: EnderecoPrincipalMap;
  representante: RepresentanteLegalMap;
} {
  if (!lock) {
    return { empresa: { ...empresa }, endereco: { ...endereco }, representante: { ...representante } };
  }
  const e = { ...empresa };
  for (const k of lock.locked_empresa_keys) {
    delete (e as Record<string, unknown>)[k];
  }
  const en = { ...endereco };
  for (const k of lock.locked_endereco_keys) {
    delete (en as Record<string, unknown>)[k];
  }
  const r = { ...representante };
  for (const k of lock.locked_representante_keys) {
    delete (r as Record<string, unknown>)[k];
  }
  return { empresa: e, endereco: en, representante: r };
}
