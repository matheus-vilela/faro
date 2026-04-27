import { isValidCnpj } from "@/lib/cnpj";
import { unmask } from "@/lib/masks";
import type {
  EmpresaMap,
  EnderecoPrincipalMap,
  FocusCnpjLockState,
  FocusNfeMap,
  SetupCertificateState,
  SetupEpocState,
  SetupXmlZipImportState,
} from "@/types/companySetup";
import {
  FOCUS_NFE_MODELO_NFCE,
  FOCUS_NFE_MODELO_NFE,
} from "@/types/companySetup";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  const t = email.trim();
  return t.length > 0 && EMAIL_RE.test(t);
}

export type ValidateStep1EmpresaOpts = {
  /** No onboarding da unidade, exige validação Focus do CNPJ antes de avançar. */
  requireFocusCnpjValidation?: boolean;
  focusCnpjLock?: FocusCnpjLockState | null;
};

export function validateStep1Empresa(
  e: EmpresaMap,
  opts?: ValidateStep1EmpresaOpts,
): string | null {
  const cnpj = unmask(e.cnpj_cpf ?? "");
  if (!isValidCnpj(cnpj)) return "Informe um CNPJ válido.";
  if (opts?.requireFocusCnpjValidation) {
    const lock = opts.focusCnpjLock;
    if (!lock?.validated_cnpj_digits || lock.validated_cnpj_digits !== cnpj) {
      return "Valide o CNPJ pelo botão «Validar» antes de avançar.";
    }
  }
  const razao = (e.nome_razao_social ?? "").trim();
  if (!razao) return "Informe a razão social.";
  const fantasia = (e.nome_fantasia ?? "").trim();
  if (!fantasia) return "Informe o nome fantasia.";
  if (e.regime_tributario !== 1 && e.regime_tributario !== 2 && e.regime_tributario !== 3) {
    return "Selecione o regime tributário.";
  }
  const mail = (e.email ?? "").trim();
  if (!isValidEmail(mail)) return "Informe um e-mail válido.";
  const tel = unmask(e.telefone ?? "");
  if (tel.length < 10) return "Informe um telefone válido.";
  return null;
}

/** NFC-e exige CSC e id token em prod e homologação (quando usuário avança com modelo NFC-e). */
export function validateStep3FocusNfe(f: FocusNfeMap): string | null {
  const modelo = (f.modelo ?? "").trim();
  if (!modelo) return "Selecione o modelo da nota (NFC-e ou NF-e).";
  if (modelo !== FOCUS_NFE_MODELO_NFCE && modelo !== FOCUS_NFE_MODELO_NFE) {
    return "Modelo inválido.";
  }
  if (modelo === FOCUS_NFE_MODELO_NFCE) {
    const need = [
      ["CSC NFC-e produção", f.csc_nfce_producao],
      ["ID token NFC-e produção", f.id_token_nfce_producao],
      ["CSC NFC-e homologação", f.csc_nfce_homologacao],
      ["ID token NFC-e homologação", f.id_token_nfce_homologacao],
    ] as const;
    for (const [label, v] of need) {
      if (!(v ?? "").trim()) {
        return `Para NFC-e, preencha: ${label}.`;
      }
    }
  }
  return null;
}

function hasText(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

export function isStep1EmpresaComplete(
  e: EmpresaMap,
  opts?: ValidateStep1EmpresaOpts,
): boolean {
  return validateStep1Empresa(e, opts) == null;
}

/** Regra solicitada: etapa só conclui com todos os campos preenchidos. */
export function isStep2EnderecoComplete(e: EnderecoPrincipalMap): boolean {
  return (
    hasText(e.cep) &&
    hasText(e.logradouro) &&
    hasText(e.numero) &&
    hasText(e.bairro) &&
    hasText(e.municipio) &&
    hasText(e.uf) &&
    hasText(e.ibge_cidade)
  );
}

/** Regra solicitada: etapa só conclui com todos os campos da etapa preenchidos. */
export function isStep3FocusNfeComplete(f: FocusNfeMap): boolean {
  const modelo = (f.modelo ?? "").trim();
  if (modelo !== FOCUS_NFE_MODELO_NFCE && modelo !== FOCUS_NFE_MODELO_NFE) {
    return false;
  }
  const baseFilled =
    hasText(f.serie) &&
    hasText(f.proximoNumeroNfce) &&
    hasText(f.token_homologacao) &&
    hasText(f.token_producao);
  if (!baseFilled) return false;
  if (modelo === FOCUS_NFE_MODELO_NFCE) {
    return (
      hasText(f.csc_nfce_producao) &&
      hasText(f.id_token_nfce_producao) &&
      hasText(f.csc_nfce_homologacao) &&
      hasText(f.id_token_nfce_homologacao)
    );
  }
  return true;
}

export function isStep4CertificateComplete(
  cert: SetupCertificateState | undefined,
): boolean {
  return cert?.status === "valid";
}

/** Passo 3 antes de existir `companyId`: arquivo escolhido + base64 e senha só em memória. */
export function isStep3CertificatePayloadComplete(
  cert: SetupCertificateState | undefined,
  secrets: { certBase64: string; certPassword: string },
): boolean {
  const b64 = secrets.certBase64.trim();
  const pwd = secrets.certPassword.trim();
  return !!cert?.file_name && b64.length > 0 && pwd.length > 0;
}

/** Concluído apenas quando importação terminar. */
export function isStep5XmlZipComplete(
  xmlZip: SetupXmlZipImportState | undefined,
): boolean {
  return xmlZip?.phase === "done";
}

/**
 * PDV (integração EPOC):
 * - "no" => ignorado/concluído
 * - credenciais => usuário obrigatório; com integração ativa, senha nova ou já salva
 */
/** Passo 5 do wizard (PDV / EPOC). */
export function getStep6EpocState(
  epoc: SetupEpocState | undefined,
): { completed: boolean; skipped: boolean } {
  const mode = epoc?.mode ?? "undecided";
  if (mode === "no") return { completed: true, skipped: true };
  if (mode === "credentials") {
    const userOk = hasText(epoc?.username);
    const baseOk = !epoc?.enabled || hasText(epoc?.base_url);
    const enabled = epoc?.enabled ?? false;
    const pwdOk =
      !enabled ||
      hasText(epoc?.password) ||
      epoc?.password_on_server === true;
    return { completed: userOk && baseOk && pwdOk, skipped: false };
  }
  return { completed: false, skipped: false };
}

