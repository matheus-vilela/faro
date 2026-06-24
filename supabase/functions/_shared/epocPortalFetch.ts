import { isEpocRemoteConnectionResetError } from "./epocRemoteErrorMessage.ts";

async function readResponseBodyAsText(response: Response): Promise<string> {
  if (!response.body) {
    return await response.text();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const maxBytes = 25 * 1024 * 1024;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.length;
    if (total > maxBytes) {
      throw new Error("Resposta EPOC excedeu o limite de tamanho.");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(merged);
}

/** POST ao portal EPOC com retentativas em falhas transitórias de rede. */
export async function fetchEpocPortalPostWithRetry(
  url: string,
  init: RequestInit,
  opts?: {
    attempts?: number;
    baseDelayMs?: number;
    label?: string;
    log?: (phase: string, data: Record<string, unknown>) => void;
    onBeforeRetry?: (attempt: number) => void | Promise<void>;
  },
): Promise<{ response: Response; text: string }> {
  const attempts = opts?.attempts ?? 3;
  const baseDelayMs = opts?.baseDelayMs ?? 800;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, init);
      const text = await readResponseBodyAsText(response);
      return { response, text };
    } catch (e) {
      lastError = e;
      const msg = e instanceof Error ? e.message : String(e);
      const retryable = isEpocRemoteConnectionResetError(msg);
      if (retryable && attempt < attempts) {
        opts?.log?.("portal_fetch_retry", {
          label: opts?.label ?? url,
          attempt,
          next_attempt: attempt + 1,
          message: msg,
        });
        await opts?.onBeforeRetry?.(attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, attempt * baseDelayMs));
        continue;
      }
      throw e instanceof Error ? e : new Error(msg);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError ?? "Falha de rede ao contactar o portal EPOC."));
}

/** Oculta token de sessão em bodies/log de form POST. */
export function redactEpocFormBody(body: string): string {
  return body.replace(/(^|&)(token=)[^&]*/gi, "$1$2[REDACTED]");
}
