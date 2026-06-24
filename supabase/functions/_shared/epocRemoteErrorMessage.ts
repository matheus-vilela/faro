/** Mensagem amigável quando o portal EPOC fecha a conexão ou não responde. */
export const EPOC_REMOTE_CONNECTION_RESET_MESSAGE =
  "O sistema remoto não respondeu corretamente. Verifique a conexão e tente novamente.";

/**
 * Detecta falhas de rede ao contactar o portal EPOC (ex.: reqwest/hyper
 * "Connection reset by peer"). O host/path no texto do erro varia conforme a
 * URL base configurada na integração — a detecção não depende de um endereço fixo.
 */
export function isEpocRemoteConnectionResetError(message: string): boolean {
  const lower = message.trim().toLowerCase();
  if (!lower) return false;
  return (
    lower.includes("connection reset by peer") ||
    lower.includes("os error 104") ||
    (lower.includes("sendrequest") && lower.includes("connection error")) ||
    (lower.includes("error sending request") && lower.includes("connection error"))
  );
}

export function humanizeEpocRemoteError(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return trimmed;
  if (isEpocRemoteConnectionResetError(trimmed)) {
    return EPOC_REMOTE_CONNECTION_RESET_MESSAGE;
  }
  return trimmed;
}
