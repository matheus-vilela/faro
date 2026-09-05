import type { FocusCnpjConsultaData } from "@/types/focusCnpjConsulta";

export type SupplierFromFocusCnpj = {
  name: string;
  document: string;
  email?: string;
  phone?: string;
};

function str(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

function firstStr(
  extra: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = str(extra[key]);
    if (value) return value;
  }
  return undefined;
}

/**
 * Extrai nome/documento (e contato, se a API enviar) para o cadastro de fornecedor.
 * Não aplica endereço: a tabela `suppliers` não tem esses campos.
 */
export function applyFocusCnpjToSupplier(
  data: FocusCnpjConsultaData,
): SupplierFromFocusCnpj | null {
  const extra = data as Record<string, unknown>;
  const document = String(data.cnpj ?? "")
    .replace(/\D/g, "")
    .slice(0, 14);
  const name =
    str(data.razao_social) ||
    firstStr(extra, ["nome_fantasia", "nome_empresarial"]);
  if (!name || document.length !== 14) return null;

  const email = firstStr(extra, ["email", "e_mail", "email_contato"]);
  const phoneRaw = firstStr(extra, [
    "telefone",
    "telefone1",
    "ddd_telefone_1",
    "numero_telefone",
  ]);
  const phone = phoneRaw?.replace(/\D/g, "") || undefined;

  return {
    name,
    document,
    email,
    phone,
  };
}

/** CNPJ (14) ou CPF (11) digitados na busca do seletor. */
export function documentDigitsFromQuery(query: string): string {
  const digits = query.replace(/\D/g, "");
  if (digits.length === 11 || digits.length === 14) return digits;
  return "";
}
