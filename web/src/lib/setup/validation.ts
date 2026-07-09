import { isValidCnpj } from "@/lib/cnpj";
import { unmask } from "@/lib/masks";
import type {
  CertificateFiscalMode,
  EmpresaMap,
  EnderecoPrincipalMap,
  EpocWizardMode,
  FocusCnpjLockState,
  FocusNfeMap,
  PdvSalesOption,
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
      return "Busque o CNPJ na Receita antes de avançar.";
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
  if (mail.length > 0 && !isValidEmail(mail)) return "Informe um e-mail válido.";
  const tel = unmask(e.telefone ?? "");
  if (tel.length > 0 && tel.length < 10) return "Informe um telefone válido.";
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
  if (cert?.mode === "skip") return true;
  return cert?.status === "valid";
}

/** Passo fiscal: pode avançar no wizard conforme o modo escolhido. */
export function isFiscalStepAdvanceAllowed(
  cert: SetupCertificateState | undefined,
  secrets: { certBase64: string; certPassword: string },
  opts?: { companyId?: string | null },
): string | null {
  const mode: CertificateFiscalMode = cert?.mode ?? "undecided";
  if (mode === "undecided") {
    return "Escolha como deseja conectar o certificado digital.";
  }
  if (mode === "skip") return null;
  if (mode === "upload_now") {
    if (cert?.status === "valid") return null;
    if (!isStep3CertificatePayloadComplete(cert, secrets)) {
      return "Envie o certificado A1 (PFX/P12) e informe a senha.";
    }
    return null;
  }
  if (mode === "delegate_link") {
    if (!cert?.delegation_link_id) {
      return "Gere o link para enviar a outra pessoa antes de continuar.";
    }
    if (!opts?.companyId) {
      return "Aguarde a criação da unidade para gerar o link.";
    }
    return null;
  }
  return "Opção de certificado inválida.";
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

export function resolvePdvOption(epoc?: SetupEpocState): PdvSalesOption {
  if (epoc?.pdv_option) return epoc.pdv_option;
  if (epoc?.mode === "credentials") return "epoc";
  if (epoc?.mode === "no") {
    return hasText(epoc.other_system_name) ? "other_system" : "no_system";
  }
  return "undecided";
}

export function pdvOptionToMode(option: PdvSalesOption): EpocWizardMode {
  if (option === "epoc") return "credentials";
  if (option === "no_system" || option === "other_system") return "no";
  return "undecided";
}

function isEpocCredentialsComplete(epoc: SetupEpocState): boolean {
  const userOk = hasText(epoc.username);
  const baseOk = !epoc.enabled || hasText(epoc.base_url);
  const enabled = epoc.enabled ?? false;
  const pwdOk =
    !enabled || hasText(epoc.password) || epoc.password_on_server === true;
  return userOk && baseOk && pwdOk;
}

/** Passo PDV: pode avançar no wizard conforme a opção escolhida. */
export function isPdvStepAdvanceAllowed(
  epoc: SetupEpocState | undefined,
): string | null {
  const option = resolvePdvOption(epoc);
  if (option === "undecided") {
    return "Escolha como você registra suas vendas.";
  }
  if (option === "other_system") {
    if (!hasText(epoc?.other_system_name)) {
      return "Informe o nome do sistema que você utiliza.";
    }
    return null;
  }
  if (option === "no_system") return null;
  if (!epoc || !isEpocCredentialsComplete(epoc)) {
    return "Preencha os dados da integração Epoc antes de concluir.";
  }
  return null;
}

/**
 * PDV (integração EPOC):
 * - no_system => ignorado/concluído
 * - other_system => concluído com nome do sistema
 * - epoc => credenciais obrigatórias quando ativo
 */
/** Passo 5 do wizard (PDV / EPOC). */
export function getStep6EpocState(
  epoc: SetupEpocState | undefined,
): { completed: boolean; skipped: boolean } {
  const option = resolvePdvOption(epoc);
  if (option === "no_system") return { completed: true, skipped: true };
  if (option === "other_system") {
    return {
      completed: hasText(epoc?.other_system_name),
      skipped: false,
    };
  }
  if (option === "epoc" && epoc) {
    return {
      completed: isEpocCredentialsComplete(epoc),
      skipped: false,
    };
  }
  return { completed: false, skipped: false };
}

