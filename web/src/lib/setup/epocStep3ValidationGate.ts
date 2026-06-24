import type { SetupEpocState } from "@/types/companySetup";
import { humanizeEpocRemoteError } from "@/lib/epocRemoteErrorMessage";

export type EpocValidateLoginErrorCode =
  | "INVALID_URL"
  | "INVALID_CREDENTIALS"
  | "SERVER_UNAVAILABLE"
  | "UNKNOWN_ERROR";

export type EpocValidateLoginResponse =
  | { success: true }
  | {
      success: false;
      errorCode: EpocValidateLoginErrorCode;
      message: string;
    };

/** Chamar a Edge Function só com integração EPOC ativa e dados mínimos preenchidos. */
export function shouldValidateEpocBeforeStep3Complete(
  epoc: SetupEpocState | undefined,
  opts: {
    hasResolvedPassword: boolean;
    baseUrlTrimmed: string;
    usernameTrimmed: string;
  },
): boolean {
  const mode = epoc?.mode ?? "undecided";
  if (mode !== "credentials") return false;
  if (epoc?.enabled !== true) return false;
  if (!opts.baseUrlTrimmed || !opts.usernameTrimmed) return false;
  if (!opts.hasResolvedPassword) return false;
  return true;
}

/** Texto devolvido pela edge em falhas de módulo/sessão; não repetir no card (já há dicas). */
export const EPOC_VALIDATE_LOGIN_SUPPRESSED_ONBOARDING_DETAIL =
  "Verifique credenciais, NaoMenu e o módulo configurado.";

/** Normaliza mensagem da API; vazio = sem parágrafo extra no card de onboarding. */
export function sanitizeEpocOnboardingValidateMessage(message: string): string {
  const m = humanizeEpocRemoteError(message.trim());
  if (!m) return m;
  if (m === EPOC_VALIDATE_LOGIN_SUPPRESSED_ONBOARDING_DETAIL) {
    return "";
  }
  if (
    m.includes("ConteudoTela") &&
    (m.includes("acoes.php") || m.includes("fase1"))
  ) {
    return "";
  }
  return m;
}

export function normalizeEpocValidateLoginResponse(
  raw: unknown,
): EpocValidateLoginResponse {
  if (!raw || typeof raw !== "object") {
    return {
      success: false,
      errorCode: "UNKNOWN_ERROR",
      message: "Resposta inválida do servidor.",
    };
  }
  const o = raw as Record<string, unknown>;
  if (o.success === true) {
    return { success: true };
  }
  const codeRaw = o.errorCode;
  const messageRaw =
    typeof o.message === "string" && o.message.trim()
      ? o.message.trim()
      : "Não foi possível validar o acesso ao EPOC.";
  const message = sanitizeEpocOnboardingValidateMessage(messageRaw);
  const codes: EpocValidateLoginErrorCode[] = [
    "INVALID_URL",
    "INVALID_CREDENTIALS",
    "SERVER_UNAVAILABLE",
    "UNKNOWN_ERROR",
  ];
  const errorCode = codes.includes(codeRaw as EpocValidateLoginErrorCode)
    ? (codeRaw as EpocValidateLoginErrorCode)
    : "UNKNOWN_ERROR";
  return { success: false, errorCode, message };
}
