import { LOG } from "./constants.ts";
import { sleep } from "./http.ts";

export function focusBasicAuthHeader(token: string): string {
  const pair = `${token.trim()}:`;
  let binary = "";
  for (let i = 0; i < pair.length; i++) {
    binary += String.fromCharCode(pair.charCodeAt(i));
  }
  return `Basic ${btoa(binary)}`;
}

function throttleMsBetweenXmlDownloads(): number {
  const raw = Deno.env.get("FOCUS_NFE_XML_THROTTLE_MS")?.trim();
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  return 450;
}

/** Modo teste: sem espera entre downloads (só 1 XML por vez na prática). */
export function throttleMsForSyncRun(manualTestMode: boolean): number {
  if (manualTestMode) return 0;
  return throttleMsBetweenXmlDownloads();
}

export function retryAfterDelayMs(res: Response): number | null {
  const raw = res.headers.get("Retry-After")?.trim();
  if (!raw) return null;
  const secs = Number(raw);
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 300_000);
  const deadline = Date.parse(raw);
  if (Number.isFinite(deadline)) {
    const w = deadline - Date.now();
    if (Number.isFinite(w)) return Math.min(Math.max(0, Math.floor(w)), 300_000);
  }
  return null;
}

export async function fetchNfeRecebidaXmlWithRetry(
  xmlUrl: string,
  focusToken: string,
  chaveNfe44: string,
): Promise<{ ok: true; buf: Uint8Array } | { ok: false; status: number }> {
  const maxAttempts = 10;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let xmlRes: Response;
    try {
      xmlRes = await fetch(xmlUrl, {
        method: "GET",
        headers: {
          Authorization: focusBasicAuthHeader(focusToken),
          Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
        },
      });
    } catch (e) {
      console.warn(
        LOG,
        JSON.stringify({
          fase: "xml_focus_erro_rede",
          chave_nfe_44: chaveNfe44,
          tentativa: attempt,
          erro: String(e),
        }),
      );
      if (attempt === maxAttempts) {
        return { ok: false, status: 0 };
      }
      await sleep(Math.min(3000 * attempt, 25_000));
      continue;
    }

    const buf = new Uint8Array(await xmlRes.arrayBuffer());

    if (xmlRes.status === 429) {
      const fromHeader = retryAfterDelayMs(xmlRes);
      const backoff = Math.min(1500 * 2 ** (attempt - 1), 90_000);
      const waitMs = fromHeader ?? backoff;
      console.warn(
        LOG,
        `xml HTTP 429 chave=${chaveNfe44} tentativa=${attempt}/${maxAttempts} espera_ms=${waitMs}`,
      );
      if (attempt === maxAttempts) return { ok: false, status: 429 };
      await sleep(waitMs);
      continue;
    }

    if (
      (xmlRes.status === 503 || xmlRes.status === 502) &&
      attempt < maxAttempts
    ) {
      const waitMs = Math.min(4000 * attempt, 45_000);
      console.warn(
        LOG,
        `xml HTTP ${xmlRes.status} chave=${chaveNfe44} retry em ${waitMs}ms`,
      );
      await sleep(waitMs);
      continue;
    }

    if (xmlRes.ok && buf.length >= 500) {
      return { ok: true, buf };
    }

    console.warn(
      LOG,
      JSON.stringify({
        fase: "xml_focus_resposta",
        chave_nfe_44: chaveNfe44,
        mensagem: "HTTP não OK ou payload pequeno",
        http_status: xmlRes.status,
        bytes: buf.length,
      }),
    );
    return { ok: false, status: xmlRes.status };
  }
  return { ok: false, status: 429 };
}
