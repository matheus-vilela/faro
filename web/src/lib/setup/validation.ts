import { isValidCnpj } from "@/lib/cnpj";
import { unmask } from "@/lib/masks";
import type { EmpresaMap, FocusNfeMap } from "@/types/companySetup";
import {
  FOCUS_NFE_MODELO_NFCE,
  FOCUS_NFE_MODELO_NFE,
} from "@/types/companySetup";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  const t = email.trim();
  return t.length > 0 && EMAIL_RE.test(t);
}

export function validateStep1Empresa(e: EmpresaMap): string | null {
  const cnpj = unmask(e.cnpj_cpf ?? "");
  if (!isValidCnpj(cnpj)) return "Informe um CNPJ válido.";
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
