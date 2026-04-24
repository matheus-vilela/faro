import type { FocusNfeMap } from "@/types/companySetup";

const SECRET_FOCUS_KEYS = [
  "arquivo_certificado_base64",
  "senha_certificado",
] as const;

/** Remove segredos antes de gravar `companies.focusnfe` ou ao hidratar o estado no cliente. */
export function stripFocusnfeSecrets(
  raw: FocusNfeMap | Record<string, unknown> | undefined | null,
): FocusNfeMap {
  const out = {
    ...((raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>),
  };
  for (const k of SECRET_FOCUS_KEYS) delete out[k];
  return out as FocusNfeMap;
}
