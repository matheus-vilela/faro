import type { FocusNfeMap } from "@/types/companySetup";
import type { CertificateUploadStatus } from "@/types/companySetup";

/**
 * Ponto de extensão para validação real do certificado A1 junto à Focus NFe.
 * Nesta entrega retorna sucesso simulado após um pequeno atraso.
 */
export async function validateCertificateWithFocusNfe(_input: {
  companyId: string;
  /** Legado: arquivo no bucket `company-setup`. */
  storagePath?: string;
  /** Preferível: conteúdo A1 em base64 (não persistido). */
  certBase64?: string;
  password: string;
}): Promise<{
  status: Extract<CertificateUploadStatus, "valid" | "invalid">;
  certificado_validade?: string;
  error_message?: string;
}> {
  await new Promise((r) => setTimeout(r, 900));
  const validUntil = new Date();
  validUntil.setFullYear(validUntil.getFullYear() + 1);
  return {
    status: "valid",
    certificado_validade: validUntil.toISOString().slice(0, 10),
  };
}

/** Reservado para envio do certificado / sincronização de tokens com a API Focus. */
export async function syncFocusNfeCompanyProfile(
  _companyId: string,
  _focus: FocusNfeMap,
): Promise<{ ok: boolean; error?: string }> {
  return { ok: true };
}
