import {
  FOCUS_AUTO_RATE_LIMITED,
  acquireFocusAutoCall,
} from "../focusApiAutoRateLimit.ts";

export function focusBasicAuthHeader(token: string): string {
  const pair = `${token.trim()}:`;
  let binary = "";
  for (let i = 0; i < pair.length; i++) {
    binary += String.fromCharCode(pair.charCodeAt(i));
  }
  return `Basic ${btoa(binary)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => globalThis.setTimeout(r, ms));
}

function intHeader(res: Response, canonical: string): number | null {
  const raw = res.headers.get(canonical);
  if (raw == null || String(raw).trim() === "") return null;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function retryAfterDelayMs(res: Response): number | null {
  const raw = res.headers.get("Retry-After")?.trim();
  if (!raw) return null;
  const secs = Number(raw);
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 300_000);
  const deadline = Date.parse(raw);
  if (Number.isFinite(deadline)) {
    const w = deadline - Date.now();
    if (Number.isFinite(w)) {
      return Math.min(Math.max(0, Math.floor(w)), 300_000);
    }
  }
  return null;
}

export function isNfeCompletaExplicitTrue(raw: unknown): boolean {
  if (raw === true) return true;
  if (raw === 1) return true;
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "sim" || s === "yes") return true;
  }
  return false;
}

export type FocusListPageResult =
  | {
    ok: true;
    items: Record<string, unknown>[];
    xTotalCount: number | null;
    xMaxVersion: number | null;
    status: number;
  }
  | {
    ok: false;
    status: number | null;
    error: string;
    retryAfterMs?: number;
    network?: boolean;
  };

export async function fetchNfesRecebidasPage(input: {
  apiBase: string;
  token: string;
  cnpjDigits: string;
  versao: number;
}): Promise<FocusListPageResult> {
  const slot = await acquireFocusAutoCall({ source: "nfe_list" });
  if (!slot.allowed) {
    return {
      ok: false,
      status: 429,
      error: FOCUS_AUTO_RATE_LIMITED,
      retryAfterMs: slot.waitMs,
    };
  }

  const listUrl =
    `${input.apiBase}/v2/nfes_recebidas?cnpj=${
      encodeURIComponent(input.cnpjDigits)
    }&versao=${input.versao}`;

  let listRes: Response;
  try {
    listRes = await fetch(listUrl, {
      method: "GET",
      headers: {
        Authorization: focusBasicAuthHeader(input.token),
        Accept: "application/json",
      },
    });
  } catch (e) {
    return {
      ok: false,
      status: null,
      network: true,
      error: e instanceof Error ? e.message : String(e),
      retryAfterMs: 30_000,
    };
  }

  const xTotalCount = intHeader(listRes, "x-total-count");
  const xMaxVersion = intHeader(listRes, "x-max-version");
  const listText = await listRes.text();

  if (listRes.status === 429) {
    return {
      ok: false,
      status: 429,
      error: `Focus lista HTTP 429: ${listText.slice(0, 200)}`,
      retryAfterMs: retryAfterDelayMs(listRes) ?? 60_000,
    };
  }

  if (!listRes.ok) {
    return {
      ok: false,
      status: listRes.status,
      error: `Focus lista HTTP ${listRes.status}: ${listText.slice(0, 200)}`,
      retryAfterMs: listRes.status >= 500 ? 60_000 : undefined,
    };
  }

  let lista: unknown;
  try {
    lista = listText ? JSON.parse(listText) : [];
  } catch {
    return {
      ok: false,
      status: listRes.status,
      error: "Resposta lista inválida",
    };
  }

  if (!Array.isArray(lista)) {
    return {
      ok: false,
      status: listRes.status,
      error: "Formato de lista inesperado",
    };
  }

  return {
    ok: true,
    items: lista as Record<string, unknown>[],
    xTotalCount,
    xMaxVersion,
    status: listRes.status,
  };
}

export type FocusXmlResult =
  | { ok: true; text: string }
  | { ok: false; status: number; retryAfterMs?: number; error: string };

export async function fetchNfeRecebidaXml(input: {
  apiBase: string;
  token: string;
  cnpjDigits: string;
  chave44: string;
  maxAttempts?: number;
}): Promise<FocusXmlResult> {
  const xmlUrl =
    `${input.apiBase}/v2/nfes_recebidas/${
      encodeURIComponent(input.chave44)
    }.xml?cnpj=${encodeURIComponent(input.cnpjDigits)}`;
  const maxAttempts = input.maxAttempts ?? 6;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const slot = await acquireFocusAutoCall({ source: "nfe_xml" });
    if (!slot.allowed) {
      return {
        ok: false,
        status: 429,
        error: FOCUS_AUTO_RATE_LIMITED,
        retryAfterMs: slot.waitMs,
      };
    }

    let xmlRes: Response;
    try {
      xmlRes = await fetch(xmlUrl, {
        method: "GET",
        headers: {
          Authorization: focusBasicAuthHeader(input.token),
          Accept: "application/xml,text/xml;q=0.9,*/*;q=0.8",
        },
      });
    } catch (e) {
      if (attempt === maxAttempts) {
        return {
          ok: false,
          status: 0,
          error: e instanceof Error ? e.message : String(e),
          retryAfterMs: 30_000,
        };
      }
      await sleep(Math.min(3000 * attempt, 20_000));
      continue;
    }

    const buf = new Uint8Array(await xmlRes.arrayBuffer());

    if (xmlRes.status === 429) {
      const waitMs = retryAfterDelayMs(xmlRes) ??
        Math.min(1500 * 2 ** (attempt - 1), 90_000);
      if (attempt === maxAttempts) {
        return {
          ok: false,
          status: 429,
          error: "HTTP 429 no download XML",
          retryAfterMs: waitMs,
        };
      }
      await sleep(waitMs);
      continue;
    }

    if ((xmlRes.status === 503 || xmlRes.status === 502) && attempt < maxAttempts) {
      await sleep(Math.min(4000 * attempt, 45_000));
      continue;
    }

    if (xmlRes.ok && buf.length >= 500) {
      const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
      const head = text.slice(0, Math.min(200, text.length)).toLowerCase();
      if (!head.includes("nfe") && !head.includes("nfeproc")) {
        return {
          ok: false,
          status: xmlRes.status,
          error: "XML corpo suspeito (sem marcadores nfe)",
        };
      }
      return { ok: true, text };
    }

    return {
      ok: false,
      status: xmlRes.status,
      error: `HTTP ${xmlRes.status} ou payload pequeno (${buf.length} bytes)`,
      retryAfterMs: xmlRes.status >= 500 ? 45_000 : undefined,
    };
  }

  return { ok: false, status: 0, error: "esgotaram tentativas de download" };
}
