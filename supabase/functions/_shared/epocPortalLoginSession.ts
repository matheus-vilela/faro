/**
 * Login no portal EPOC até obter cookies de sessão + token (mesma sequência que epoc-sync-csv).
 * Usado por epoc-validate-login (sem gravação de steps) e por epoc-sync-csv (com hooks de trace).
 */
import { fetchEpocPortalPostWithRetry } from "./epocPortalFetch.ts";
import { humanizeEpocRemoteError } from "./epocRemoteErrorMessage.ts";

export type EpocPortalLoginErrorCode =
  | "INVALID_URL"
  | "INVALID_CREDENTIALS"
  | "SERVER_UNAVAILABLE"
  | "UNKNOWN_ERROR";

export type EpocPortalLoginResult =
  | {
      ok: true;
      cookies: string;
      token: string;
      origin: string;
      refererIndex: string;
    }
  | {
      ok: false;
      errorCode: EpocPortalLoginErrorCode;
      message: string;
    };

export type EpocPortalLoginRecording = {
  recordUpload: (
    name: string,
    label: string,
    fileName: string,
    bytes: Uint8Array,
    contentType: string,
    base: Record<string, unknown>,
  ) => Promise<void>;
  recordPlain: (
    name: string,
    label: string,
    base: Record<string, unknown>,
  ) => void;
};

export type PerformEpocPortalLoginParams = {
  normalizedBaseUrl: string;
  username: string;
  password: string;
  loginPath: string;
  userFieldFromSettings: string;
  passFieldFromSettings: string;
  hidden: Record<string, string>;
  signal?: AbortSignal;
  recording?: EpocPortalLoginRecording;
  /**
   * Se true, após login executa validadorOz + acoes fase1 e exige id=ConteudoTela
   * (mesma verificação que epoc-sync-csv antes da janela de dias).
   */
  probeConteudoTelaAfterLogin?: boolean;
  /** NaoMenu / código filial; quando em probe, default `123A` se vazio. */
  naoMenu?: string;
  /** Default true — incluir token nos POSTs da probe. */
  sendToken?: boolean;
};

const DEFAULT_LOGIN_PATH = "/index.php";
const DEFAULT_USER_FIELD = "user";
const DEFAULT_PASS_FIELD = "senha";
const PATH_INDEX = "/index.php";
const PATH_VALIDADOR_OZ = "/validadorOz.php";
const PATH_ACOES = "/acoes.php";
const MODULO_REL = "mod_rel_produto_sintetico";
const DEFAULT_NAOMENU = "123A";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

const EPOC_ID_CONTEUDO_TELA = "ConteudoTela";
const EPOC_ID_TBL_EXPORT = "tblExport";

function trimBaseUrl(base: string): string {
  return base.trim().replace(/\/$/, "");
}

/** Igual ao epoc-sync-csv: origem sem `/index.php` final. */
export function normalizeEpocBaseUrlInput(base: string): string {
  const t = trimBaseUrl(base);
  const lower = t.toLowerCase();
  const suf = "/index.php";
  if (lower.endsWith(suf)) {
    return t.slice(0, -suf.length).replace(/\/$/, "") || t.slice(0, -suf.length);
  }
  return t;
}

function buildActionUrl(baseUrl: string, loginPath: string): string {
  const b = trimBaseUrl(baseUrl);
  const p = (loginPath.trim() || DEFAULT_LOGIN_PATH).replace(/^\//, "");
  return `${b}/${p}`;
}

function resolveUrlAgainstBase(baseUrl: string, pathOrUrl: string): string {
  const t = pathOrUrl.trim();
  if (t.startsWith("http://") || t.startsWith("https://")) return t;
  const path = t.startsWith("/") ? t : `/${t}`;
  return `${trimBaseUrl(baseUrl)}${path}`;
}

function collectSetCookieHeader(headers: Headers): string {
  const pairs: string[] = [];
  headers.forEach((val, key) => {
    if (key.toLowerCase() === "set-cookie") {
      const nameValue = val.split(";")[0]?.trim() ?? "";
      if (nameValue) pairs.push(nameValue);
    }
  });
  return pairs.join("; ");
}

function mergeCookieStrings(a: string, b: string): string {
  const m = new Map<string, string>();
  for (const part of [a, b].filter(Boolean).join("; ").split(/;\s*/)) {
    const t = part.trim();
    if (!t) continue;
    const eq = t.indexOf("=");
    if (eq > 0) m.set(t.slice(0, eq), t.slice(eq + 1));
  }
  return [...m.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function cookieNameList(jar: string): string {
  if (!jar.trim()) return "(vazio)";
  return jar
    .split(/;\s*/)
    .map((p) => p.split("=")[0]?.trim() ?? "")
    .filter(Boolean)
    .join(", ");
}

function previewText(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}… (${s.length} chars)`;
}

function unwrapAcoesHtml(text: string): string {
  const t = text.replace(/^\uFEFF/, "").trim();
  if (!t.startsWith("{")) return t;
  try {
    const j = JSON.parse(t) as Record<string, unknown>;
    for (const k of ["conteudo", "html", "dados", "tela_html"]) {
      if (typeof j[k] === "string" && (j[k] as string).length > 0) {
        return j[k] as string;
      }
    }
  } catch {
    /* manter texto */
  }
  return t;
}

function idAttributeInMarkupRegex(elementId: string): RegExp {
  const e = elementId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `\\bid\\s*=\\s*["']${e}["']|\\bid\\s*=\\s*${e}(?=[\\s/>])`,
    "i",
  );
}

function htmlHasId(html: string, elementId: string): boolean {
  return idAttributeInMarkupRegex(elementId).test(html);
}

function hasConteudoTela(html: string): boolean {
  return htmlHasId(unwrapAcoesHtml(html), EPOC_ID_CONTEUDO_TELA);
}

function headersValidador(
  cookies: string,
  origin: string,
  referer: string,
): Record<string, string> {
  return {
    Cookie: cookies,
    Accept: "text/plain, */*;q=0.01",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "no-cache",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    DNT: "1",
    Origin: origin,
    Pragma: "no-cache",
    Referer: referer,
    "User-Agent": BROWSER_UA,
    "X-Requested-With": "XMLHttpRequest",
  };
}

function headersAcoes(
  cookies: string,
  origin: string,
  referer: string,
): Record<string, string> {
  return {
    Cookie: cookies,
    Accept: "application/json, text/javascript, */*;q=0.01",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    "Cache-Control": "no-cache",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    DNT: "1",
    Origin: origin,
    Pragma: "no-cache",
    Referer: referer,
    "User-Agent": BROWSER_UA,
    "X-Requested-With": "XMLHttpRequest",
  };
}

function inspectResponseHtml(text: string): {
  has_id_conteudo_tela: boolean;
  has_id_tbl_export: boolean;
  has_login_form: boolean;
  has_token_field: boolean;
  parece_json: boolean;
} {
  const t = unwrapAcoesHtml(text);
  return {
    has_id_conteudo_tela: htmlHasId(t, EPOC_ID_CONTEUDO_TELA),
    has_id_tbl_export: htmlHasId(t, EPOC_ID_TBL_EXPORT),
    has_login_form:
      /name\s*=\s*["'](?:senha|password|user|usuario)["']/i.test(t) &&
      /<form\b[^>]*>/i.test(t),
    has_token_field:
      /name\s*=\s*["']token["']/i.test(t) || /Tente_A_Vontade_/i.test(t),
    parece_json: text
      .replace(/^\uFEFF/, "")
      .trim()
      .startsWith("{"),
  };
}

function extractTokenFromHtml(html: string): string {
  const patterns: RegExp[] = [
    /name=["']token["'][^>]*value=["']([^"']*)/i,
    /id=["']token["'][^>]*value=["']([^"']+)/i,
    /value=["']([^"']+)["'][^>]*name=["']token["']/i,
  ];
  for (const p of patterns) {
    const m = p.exec(html);
    if (m && m[1] !== undefined && m[1].length > 0) return m[1];
  }
  const tente = /Tente_A_Vontade_[^\s"'<>&]+/.exec(html);
  if (tente) return tente[0].trim();
  return "";
}

function extractHiddenInputsFromHtml(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re =
    /<input\b[^>]*\btype\s*=\s*["']?hidden["']?[^>]*>|<input\b[^>]*\bname\s*=\s*["'][^"']+["'][^>]*\btype\s*=\s*["']?hidden["']?[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    const nameM = /\bname\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (!nameM || !nameM[1]) continue;
    const valueM = /\bvalue\s*=\s*["']([^"']*)["']/i.exec(tag);
    out[nameM[1]] = valueM?.[1] ?? "";
  }
  return out;
}

function parseFormMethodAttribute(formOpenTag: string): "get" | "post" | null {
  const mm = /\bmethod\s*=\s*["']?\s*(get|post)\b/i.exec(formOpenTag);
  if (!mm?.[1]) return null;
  return mm[1].toLowerCase() === "get" ? "get" : "post";
}

function extractLoginFormHints(html: string): {
  action: string | null;
  userField: string | null;
  passField: string | null;
  method: "get" | "post" | null;
} {
  const formOpenRe = /<form\b([^>]*)>/gi;
  const lowerHtml = html.toLowerCase();
  let m: RegExpExecArray | null;
  const blocks: Array<{ formTag: string; inner: string }> = [];
  while ((m = formOpenRe.exec(html)) !== null) {
    const innerStart = m.index + m[0].length;
    const closeIdx = lowerHtml.indexOf("</form>", innerStart);
    if (closeIdx < 0) continue;
    blocks.push({
      formTag: m[0],
      inner: html.slice(innerStart, closeIdx),
    });
  }

  const hasLoginPassword = (inner: string) =>
    /<input\b[^>]*\btype\s*=\s*["']?\s*password\b/i.test(inner) ||
    /<input\b[^>]*\bname\s*=\s*["']senha["']/i.test(inner);

  const loginBlocks = blocks.filter((b) => hasLoginPassword(b.inner));
  const pick =
    loginBlocks[0] ??
    (blocks.length > 0 ? blocks[0] : { formTag: "", inner: html });

  const formTag = pick.formTag;
  const actionMatch = /\baction\s*=\s*["']([^"']+)["']/i.exec(formTag);
  const action = actionMatch?.[1]?.trim() || null;
  const method = formTag ? parseFormMethodAttribute(formTag) : null;

  let passField: string | null = null;
  let userField: string | null = null;

  const inputRe = /<input\b[^>]*>/gi;
  let im: RegExpExecArray | null;
  while ((im = inputRe.exec(pick.inner)) !== null) {
    const tag = im[0];
    const type = (
      /\btype\s*=\s*["']?([^"'\s>]+)["']?/i.exec(tag)?.[1] ?? ""
    ).toLowerCase();
    const name = /\bname\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? "";
    if (!name) continue;
    if (!passField && type === "password") {
      passField = name;
      continue;
    }
    if (
      !userField &&
      (type === "text" || type === "email" || type === "" || type === "tel")
    ) {
      userField = name;
    }
  }
  return { action, userField, passField, method };
}

function escapeHtmlForPre(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildRawDebugDocument(
  title: string,
  note: string,
  rawText: string,
): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
body{font-family:system-ui,Segoe UI,sans-serif;padding:12px 16px;margin:0}
pre{white-space:pre-wrap;word-break:break-all;background:#f6f8fa;border:1px solid #e1e4e8;border-radius:6px;padding:12px;max-width:100%}
p.note{color:#666;font-size:0.9rem}
</style>
</head>
<body>
<p class="note">${note}</p>
<pre>${escapeHtmlForPre(rawText)}</pre>
</body>
</html>
`;
}

function classifyNetworkError(e: unknown): EpocPortalLoginFail {
  const msg = e instanceof Error ? e.message : String(e);
  const humanized = humanizeEpocRemoteError(msg);
  if (humanized !== msg.trim()) {
    return {
      ok: false,
      errorCode: "SERVER_UNAVAILABLE",
      message: humanized,
    };
  }
  if (e instanceof Error && e.name === "AbortError") {
    return {
      ok: false,
      errorCode: "SERVER_UNAVAILABLE",
      message: "Tempo limite ao contactar o servidor EPOC.",
    };
  }
  const lower = msg.toLowerCase();
  if (
    lower.includes("fetch") ||
    lower.includes("network") ||
    lower.includes("dns") ||
    lower.includes("connection") ||
    lower.includes("econnrefused") ||
    lower.includes("failed")
  ) {
    return {
      ok: false,
      errorCode: "SERVER_UNAVAILABLE",
      message: "Não foi possível ligar ao servidor EPOC. Verifique rede e URL.",
    };
  }
  return {
    ok: false,
    errorCode: "UNKNOWN_ERROR",
    message: msg.slice(0, 500),
  };
}

/** Valida URL/login/senha no portal EPOC (sem gravar artefactos se `recording` omitido). */
export async function performEpocPortalLogin(
  params: PerformEpocPortalLoginParams,
): Promise<EpocPortalLoginResult> {
  const {
    normalizedBaseUrl: baseUrl,
    username,
    password,
    loginPath,
    userFieldFromSettings,
    passFieldFromSettings,
    hidden,
    signal,
    recording,
    probeConteudoTelaAfterLogin,
    naoMenu: naoMenuParam,
    sendToken: sendTokenParam,
  } = params;

  const recUp = recording?.recordUpload;
  const recPl = recording?.recordPlain;

  const normalized = normalizeEpocBaseUrlInput(baseUrl);
  if (!normalized?.trim()) {
    return {
      ok: false,
      errorCode: "INVALID_URL",
      message: "URL base do EPOC não informada.",
    };
  }
  if (!username?.trim() || !password) {
    return {
      ok: false,
      errorCode: "INVALID_CREDENTIALS",
      message: "Usuário e senha são obrigatórios para validar o acesso.",
    };
  }

  const actionUrl = buildActionUrl(normalized, loginPath);
  const form = new URLSearchParams();

  let cookies = "";
  let hiddenFromPage: Record<string, string> = {};
  let loginActionOverride: string | null = null;
  let loginFormMethodHint: "get" | "post" | null = null;
  let userFieldAuto: string | null = null;
  let passFieldAuto: string | null = null;

  try {
    const preLoginRes = await fetch(actionUrl, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,*/*",
        "User-Agent": BROWSER_UA,
      },
      redirect: "follow",
      signal,
    });
    {
      const more = collectSetCookieHeader(preLoginRes.headers);
      if (more) cookies = mergeCookieStrings(cookies, more);
    }
    const preLoginText = await preLoginRes.text();
    hiddenFromPage = extractHiddenInputsFromHtml(preLoginText);
    const hints = extractLoginFormHints(preLoginText);
    loginActionOverride = hints.action;
    userFieldAuto = hints.userField;
    passFieldAuto = hints.passField;
    loginFormMethodHint = hints.method;

    if (!preLoginRes.ok && preLoginRes.status >= 500) {
      if (recUp) {
        await recUp(
          "pre_login_get",
          "GET página de login (capturar hidden)",
          "pre-login.html",
          new TextEncoder().encode(preLoginText),
          preLoginRes.headers.get("Content-Type") ?? "text/html",
          {
            http_status: preLoginRes.status,
            status: "fail",
            message: `HTTP ${preLoginRes.status}`,
            detalhes: {},
          },
        );
      }
      return {
        ok: false,
        errorCode: "SERVER_UNAVAILABLE",
        message: `Servidor EPOC respondeu com erro HTTP ${preLoginRes.status}.`,
      };
    }

    if (
      !preLoginRes.ok &&
      (preLoginRes.status === 404 || preLoginRes.status === 410)
    ) {
      if (recUp) {
        await recUp(
          "pre_login_get",
          "GET página de login (capturar hidden)",
          "pre-login.html",
          new TextEncoder().encode(preLoginText),
          preLoginRes.headers.get("Content-Type") ?? "text/html",
          {
            http_status: preLoginRes.status,
            status: "fail",
            detalhes: {},
          },
        );
      }
      return {
        ok: false,
        errorCode: "INVALID_URL",
        message:
          "URL do portal EPOC não encontrada (404). Verifique o endereço base.",
      };
    }

    if (recUp) {
      await recUp(
        "pre_login_get",
        "GET página de login (capturar hidden)",
        "pre-login.html",
        new TextEncoder().encode(preLoginText),
        preLoginRes.headers.get("Content-Type") ?? "text/html",
        {
          http_status: preLoginRes.status,
          status: preLoginRes.ok ? "ok" : "warn",
          detalhes: {
            cookies: cookieNameList(cookies),
            hidden_count: Object.keys(hiddenFromPage).length,
            hidden_keys: Object.keys(hiddenFromPage).slice(0, 40),
            form_action: loginActionOverride,
            form_method: loginFormMethodHint ?? "(omitido — HTML5 default GET)",
            user_field_auto: userFieldAuto,
            pass_field_auto: passFieldAuto,
            ...inspectResponseHtml(preLoginText),
          },
        },
      );
    }
  } catch (e) {
    if (recPl) {
      recPl("pre_login_get", "GET página de login", {
        status: "warn",
        message: e instanceof Error ? e.message : String(e),
      });
    }
    return classifyNetworkError(e);
  }

  for (const [k, v] of Object.entries(hiddenFromPage)) {
    form.set(k, v);
  }
  for (const [k, v] of Object.entries(hidden)) {
    if (!form.has(k)) form.set(k, v);
  }
  const userField =
    userFieldFromSettings || userFieldAuto || DEFAULT_USER_FIELD;
  const passField =
    passFieldFromSettings || passFieldAuto || DEFAULT_PASS_FIELD;
  form.set(userField, username);
  form.set(passField, password);
  const loginSubmitUrl = loginActionOverride
    ? resolveUrlAgainstBase(normalized, loginActionOverride)
    : actionUrl;

  const loginHeaderBase: Record<string, string> = {
    Accept: "text/html,application/xhtml+xml,*/*",
    Origin: trimBaseUrl(normalized),
    Referer: actionUrl,
    "User-Agent": BROWSER_UA,
    Cookie: cookies,
  };

  async function fetchLogin(method: "GET" | "POST"): Promise<Response> {
    if (method === "GET") {
      const u = new URL(loginSubmitUrl);
      for (const [k, v] of form.entries()) {
        u.searchParams.append(k, v);
      }
      return await fetch(u.toString(), {
        method: "GET",
        headers: loginHeaderBase,
        redirect: "manual",
        signal,
      });
    }
    return await fetch(loginSubmitUrl, {
      method: "POST",
      headers: {
        ...loginHeaderBase,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
      redirect: "manual",
      signal,
    });
  }

  let loginHttpMethod: "GET" | "POST" =
    loginFormMethodHint === "get" ? "GET" : "POST";
  let loginRes: Response;
  try {
    loginRes = await fetchLogin(loginHttpMethod);
    if (
      loginRes.status === 405 &&
      loginHttpMethod === "POST" &&
      loginFormMethodHint !== "post"
    ) {
      loginHttpMethod = "GET";
      loginRes = await fetchLogin("GET");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha de rede no login EPOC";
    if (recPl) {
      recPl("login", `${loginHttpMethod} login`, {
        status: "fail",
        message: msg,
      });
    }
    return classifyNetworkError(e);
  }
  {
    const more = collectSetCookieHeader(loginRes.headers);
    if (more) cookies = mergeCookieStrings(cookies, more);
  }
  const loginLocation = loginRes.headers.get("Location") ?? null;
  let tokenFromSession = "";
  const loginBuf = await loginRes.arrayBuffer();
  const loginText = new TextDecoder("utf-8", { fatal: false })
    .decode(loginBuf)
    .replace(/^\uFEFF/, "");
  const loginInsight = inspectResponseHtml(loginText);
  const loginToken = extractTokenFromHtml(loginText);
  if (loginToken) tokenFromSession = loginToken;

  if (recUp) {
    await recUp(
      "login",
      `${loginHttpMethod} de login com user/senha`,
      "login.html",
      new TextEncoder().encode(
        buildRawDebugDocument(
          `EPOC — ${loginHttpMethod} login`,
          `URL: ${loginSubmitUrl}. Método: ${loginHttpMethod}. Status: ${loginRes.status}. Location: ${loginLocation ?? "(nenhum)"}. Campos: user=${userField}, pass=${passField}. Cookies recebidos: ${cookieNameList(cookies) || "(vazio)"}.`,
          loginText,
        ),
      ),
      "text/html; charset=utf-8",
      {
        http_status: loginRes.status,
        status: loginRes.status >= 200 && loginRes.status < 400 ? "ok" : "fail",
        message:
          loginRes.status >= 300 && loginRes.status < 400
            ? "Redirect — a seguir Location."
            : loginToken
              ? `Token detectado no login (len=${loginToken.length}).`
              : undefined,
        detalhes: {
          http_method: loginHttpMethod,
          form_method_hint: loginFormMethodHint,
          location: loginLocation,
          submit_url: loginSubmitUrl,
          form_action: loginActionOverride,
          user_field: userField,
          pass_field: passField,
          token_len: loginToken.length,
          token_previa: previewText(loginToken, 24),
          cookies: cookieNameList(cookies),
          ...loginInsight,
        },
      },
    );
  }

  if (loginRes.status >= 400) {
    if (loginRes.status === 404 || loginRes.status === 502) {
      return {
        ok: false,
        errorCode:
          loginRes.status === 404 ? "INVALID_URL" : "SERVER_UNAVAILABLE",
        message: `Falha HTTP ${loginRes.status} no login do EPOC.`,
      };
    }
    return {
      ok: false,
      errorCode: "INVALID_CREDENTIALS",
      message: "Não foi possível autenticar no EPOC (resposta HTTP inválida).",
    };
  }

  if (loginRes.status >= 300 && loginRes.status < 400 && loginLocation) {
    try {
      const nextUrl = new URL(loginLocation, loginSubmitUrl);
      const follow = await fetch(nextUrl.toString(), {
        method: "GET",
        headers: {
          Cookie: cookies,
          Accept: "text/html",
          "User-Agent": BROWSER_UA,
        },
        redirect: "manual",
        signal,
      });
      const moreCookies = collectSetCookieHeader(follow.headers);
      if (moreCookies) cookies = mergeCookieStrings(cookies, moreCookies);
      const followBuf = await follow.arrayBuffer();
      const followText = new TextDecoder("utf-8", { fatal: false })
        .decode(followBuf)
        .replace(/^\uFEFF/, "");
      if (recUp) {
        await recUp(
          "login_redirect",
          `GET ${nextUrl.pathname}`,
          "login-redirect.html",
          new TextEncoder().encode(
            buildRawDebugDocument(
              "EPOC — login redirect",
              `URL: ${nextUrl.toString()}. Status: ${follow.status}. Cookies pós-redirect: ${cookieNameList(cookies) || "(vazio)"}.`,
              followText,
            ),
          ),
          "text/html; charset=utf-8",
          {
            http_status: follow.status,
            status: follow.ok ? "ok" : "warn",
            detalhes: {
              cookies: cookieNameList(cookies),
              ...inspectResponseHtml(followText),
              token_len: extractTokenFromHtml(followText).length,
            },
          },
        );
      }
      if (!tokenFromSession) {
        const followToken = extractTokenFromHtml(followText);
        if (followToken) tokenFromSession = followToken;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (recPl) {
        recPl("login_redirect", "GET (Location)", {
          status: "warn",
          message: msg,
        });
      }
      return classifyNetworkError(e);
    }
  }

  if (!cookies.trim()) {
    return {
      ok: false,
      errorCode: "INVALID_CREDENTIALS",
      message:
        "Login não devolveu sessão válida. Verifique usuário, senha e URL.",
    };
  }

  const origin = trimBaseUrl(normalized);
  const refererIndex = `${origin}/index.php`;

  let token = tokenFromSession;
  if (!token) {
    const indexUrl = resolveUrlAgainstBase(normalized, PATH_INDEX);
    let indexHtml = "";
    try {
      const indexRes = await fetch(indexUrl, {
        method: "GET",
        headers: {
          Cookie: cookies,
          Accept: "text/html,application/xhtml+xml,*/*",
          "User-Agent": BROWSER_UA,
        },
        redirect: "follow",
        signal,
      });
      const more = collectSetCookieHeader(indexRes.headers);
      if (more) cookies = mergeCookieStrings(cookies, more);
      indexHtml = await indexRes.text();
      const insight = inspectResponseHtml(indexHtml);
      if (recUp) {
        await recUp(
          "index",
          "GET /index.php (após login)",
          "index.html",
          new TextEncoder().encode(indexHtml),
          "text/html; charset=utf-8",
          {
            http_status: indexRes.status,
            status: indexRes.ok ? "ok" : "fail",
            message: !indexRes.ok
              ? `HTTP ${indexRes.status}`
              : !insight.has_token_field
                ? "index.php não tem campo `token` nem `Tente_A_Vontade_…`."
                : undefined,
            detalhes: { cookies: cookieNameList(cookies), ...insight },
          },
        );
      }
      if (!indexRes.ok) {
        return {
          ok: false,
          errorCode:
            indexRes.status >= 500
              ? "SERVER_UNAVAILABLE"
              : "INVALID_URL",
          message: `Não foi possível carregar ${PATH_INDEX}: HTTP ${indexRes.status}.`,
        };
      }
      token = extractTokenFromHtml(indexHtml);
      if (insight.has_login_form && !token) {
        return {
          ok: false,
          errorCode: "INVALID_CREDENTIALS",
          message:
            "Credenciais recusadas pelo EPOC ou sessão não criada. Verifique login e senha.",
        };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "rede";
      if (recPl) {
        recPl("index", "GET /index.php", {
          status: "fail",
          message: msg,
        });
      }
      return classifyNetworkError(e);
    }
  } else if (recPl) {
    recPl("index_skip_com_token", "Pular GET /index.php", {
      status: "ok",
      message:
        "Token já encontrado no passo 2; seguindo para validadorOz + acoes.",
      detalhes: {
        token_len: token.length,
        token_previa: previewText(token, 24),
      },
    });
  }

  if (recPl) {
    recPl("token", "Token de sessão consolidado", {
      status: token ? "ok" : "warn",
      message: token
        ? `token len=${token.length}, prévia=${previewText(token, 12)}`
        : "Sem token explícito na sessão (login/index).",
      detalhes: {
        vazio: !token,
        previa: previewText(token, 24),
      },
    });
  }

  if (probeConteudoTelaAfterLogin === true) {
    const naoMenu =
      (naoMenuParam ?? "").trim() || DEFAULT_NAOMENU;
    const sendTok = sendTokenParam !== false;
    const tokenForBody = sendTok ? token : "";
    let jar = cookies;

    const validadorOzUrl = resolveUrlAgainstBase(normalized, PATH_VALIDADOR_OZ);
    const acoesUrl = resolveUrlAgainstBase(normalized, PATH_ACOES);
    const refererValidador = validadorOzUrl;
    const validadorBody = new URLSearchParams({
      NaoMenu: naoMenu,
      token: tokenForBody,
    }).toString();

    try {
      const vFetched = await fetchEpocPortalPostWithRetry(
        validadorOzUrl,
        {
          method: "POST",
          headers: headersValidador(jar, origin, refererIndex),
          body: validadorBody,
          redirect: "follow",
          signal,
        },
        {
          label: "validadorOz.php (fase1 probe)",
          attempts: 3,
        },
      );
      const vRes = vFetched.response;
      const moreV = collectSetCookieHeader(vRes.headers);
      if (moreV) jar = mergeCookieStrings(jar, moreV);
      if (!vRes.ok) {
        return {
          ok: false,
          errorCode:
            vRes.status >= 500 ? "SERVER_UNAVAILABLE" : "INVALID_CREDENTIALS",
          message: `validadorOz (fase1) falhou: HTTP ${vRes.status}. Verifique sessão e URL.`,
        };
      }
    } catch (e) {
      return classifyNetworkError(e);
    }

    const acoesBody = new URLSearchParams({
      modulo: MODULO_REL,
      NaoMenu: naoMenu,
      action: "",
      codForm: "",
      pagina: "",
      origem: "",
      viaPix: "",
      arquivoUpload: "",
      token: tokenForBody,
    }).toString();

    try {
      const aFetched = await fetchEpocPortalPostWithRetry(
        acoesUrl,
        {
          method: "POST",
          headers: headersAcoes(jar, origin, refererValidador),
          body: acoesBody,
          redirect: "follow",
          signal,
        },
        {
          label: "acoes.php (fase1 probe)",
          attempts: 5,
          baseDelayMs: 1200,
          onBeforeRetry: async () => {
            const refresh = await fetchEpocPortalPostWithRetry(
              validadorOzUrl,
              {
                method: "POST",
                headers: headersValidador(jar, origin, refererIndex),
                body: validadorBody,
                redirect: "follow",
                signal,
              },
              { label: "validadorOz refresh (probe)", attempts: 2 },
            );
            const moreRefresh = collectSetCookieHeader(refresh.response.headers);
            if (moreRefresh) jar = mergeCookieStrings(jar, moreRefresh);
          },
        },
      );
      const aRes = aFetched.response;
      const acoesText = aFetched.text;
      const moreA = collectSetCookieHeader(aRes.headers);
      if (moreA) jar = mergeCookieStrings(jar, moreA);
      if (!aRes.ok) {
        return {
          ok: false,
          errorCode: "INVALID_CREDENTIALS",
          message: `acoes.php (fase1) falhou: HTTP ${aRes.status}. Verifique credenciais e URL.`,
        };
      }
      if (!hasConteudoTela(acoesText)) {
        return {
          ok: false,
          errorCode: "INVALID_CREDENTIALS",
          message: "Verifique credenciais, NaoMenu e o módulo configurado.",
        };
      }
      cookies = jar;
    } catch (e) {
      return classifyNetworkError(e);
    }
  }

  return {
    ok: true,
    cookies,
    token,
    origin,
    refererIndex,
  };
}
