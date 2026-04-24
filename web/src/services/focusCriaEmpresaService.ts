import { supabase, supabaseAnonKey, supabaseUrl } from "@/lib/supabase";
import type { EmpresaMap, EnderecoPrincipalMap } from "@/types/companySetup";

const FN_PATH = "/functions/v1/focus-cria-empresa";

/** Lê arquivo como data URL e retorna apenas a parte base64 (sem prefixo). */
export function fileToPureBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (typeof r !== "string") {
        reject(new Error("Falha ao ler o certificado."));
        return;
      }
      const idx = r.indexOf(",");
      resolve(idx >= 0 ? r.slice(idx + 1) : r);
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Falha ao ler o certificado."));
    reader.readAsDataURL(file);
  });
}

/**
 * Monta o body da edge `focus-cria-empresa`.
 * Tipos numéricos alinhados ao contrato esperado pela Focus.
 */
export function buildFocusCriaEmpresaBody(input: {
  empresa: EmpresaMap;
  endereco: EnderecoPrincipalMap;
  arquivo_certificado_base64: string;
  senha_certificado: string;
}): Record<string, unknown> {
  const e = input.empresa;
  const en = input.endereco;
  const doc = (e.cnpj_cpf ?? "").replace(/\D/g, "").slice(0, 14);
  const cepDigits = (en.cep ?? "").replace(/\D/g, "").slice(0, 8);
  const cepNum = cepDigits ? parseInt(cepDigits, 10) : 0;
  const tel = (e.telefone ?? "").replace(/\D/g, "");
  const ieDigits = (e.inscricao_estadual ?? "").replace(/\D/g, "");
  const ieNum = ieDigits ? parseInt(ieDigits, 10) : 0;
  const numRaw = (en.numero ?? "").trim().replace(/\D/g, "");
  const numeroParsed = numRaw ? parseInt(numRaw, 10) : 0;

  return {
    nome: (e.nome_razao_social ?? "").trim(),
    nome_fantasia: (e.nome_fantasia ?? "").trim(),
    bairro: (en.bairro ?? "").trim(),
    cep: cepNum,
    cnpj: doc,
    complemento: (en.complemento ?? "").trim(),
    email: (e.email ?? "").trim(),
    enviar_email_destinatario: false,
    inscricao_estadual: Number.isFinite(ieNum) ? ieNum : 0,
    inscricao_municipal: 0,
    logradouro: (en.logradouro ?? "").trim(),
    numero: Number.isFinite(numeroParsed) ? numeroParsed : 0,
    regime_tributario:
      e.regime_tributario === 1 || e.regime_tributario === 2 || e.regime_tributario === 3
        ? e.regime_tributario
        : 1,
    telefone: tel,
    municipio: (en.municipio ?? "").trim(),
    uf: (en.uf ?? "").trim().toUpperCase().slice(0, 2),
    dry_run: false,
    arquivo_certificado_base64: input.arquivo_certificado_base64,
    senha_certificado: input.senha_certificado,
  };
}

/**
 * Chama a edge function `focus-cria-empresa` (POST JSON, JWT Supabase).
 */
export async function focusCriaEmpresa(
  body: Record<string, unknown>,
): Promise<
  | { ok: true; data?: unknown; envelope: Record<string, unknown> }
  | { ok: false; error: string }
> {
  const { data: sessData, error: sessErr } = await supabase.auth.getSession();
  const accessToken = sessData.session?.access_token;
  if (sessErr || !accessToken) {
    return {
      ok: false,
      error: "Sessão inválida ou expirada. Entre novamente.",
    };
  }

  const base = supabaseUrl.replace(/\/$/, "");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    apikey: supabaseAnonKey,
    "Content-Type": "application/json",
  };

  const res = await fetch(`${base}${FN_PATH}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    return { ok: false, error: "Resposta inválida do servidor." };
  }

  const o =
    parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};

  if (!res.ok) {
    const msg =
      (typeof o.error === "string" && o.error) ||
      (typeof o.message === "string" && o.message) ||
      res.statusText ||
      "Falha ao criar empresa na Focus.";
    return { ok: false, error: msg };
  }

  if (o.ok !== true) {
    return {
      ok: false,
      error:
        (typeof o.error === "string" && o.error) ||
        "A Focus não confirmou a criação da empresa.",
    };
  }

  return { ok: true, data: o.data, envelope: o };
}

function coercePositiveIntId(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) {
    const t = Math.trunc(v);
    return t > 0 ? t : undefined;
  }
  if (typeof v === "string" && /^\d+$/.test(v.trim())) {
    const n = parseInt(v.trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  return undefined;
}

/**
 * Extrai o id numérico da empresa na Focus a partir de `data` retornado pela edge
 * (`focus-cria-empresa`). Aceita formatos comuns: `{ id }`, `{ id_empresa }`,
 * `{ empresa: { id } }`, ou `data` aninhado em `{ data: ... }`.
 */
export function parseFocusCriaEmpresaIdFromResponse(
  data: unknown,
  depth = 0,
): number | undefined {
  if (depth > 6) return undefined;
  const direct = coercePositiveIntId(data);
  if (direct != null) return direct;
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const o = data as Record<string, unknown>;
  const top =
    coercePositiveIntId(o.id) ?? coercePositiveIntId(o.id_empresa);
  if (top != null) return top;
  const empresa = o.empresa;
  if (empresa && typeof empresa === "object" && !Array.isArray(empresa)) {
    const e = empresa as Record<string, unknown>;
    const fromEmp =
      coercePositiveIntId(e.id) ?? coercePositiveIntId(e.id_empresa);
    if (fromEmp != null) return fromEmp;
  }
  const nested = o.data;
  if (nested !== undefined && nested !== data) {
    const inner = parseFocusCriaEmpresaIdFromResponse(nested, depth + 1);
    if (inner != null) return inner;
  }
  return undefined;
}
