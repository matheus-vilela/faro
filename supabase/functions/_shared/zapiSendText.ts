export type ZapiSendTextResult =
  | { ok: true }
  | { ok: false; error: string; code: "zapi_not_configured" | "zapi_http" | "phone_empty" };

function stripToDigits(input: string): string {
  let s = input.trim().replace(/\s+/g, "");
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("00")) s = s.slice(2);
  return s.replace(/\D/g, "");
}

/** Envia texto via Z-API (`send-text`). Secrets: ZAPI_INSTANCE_ID, ZAPI_INSTANCE_TOKEN, ZAPI_CLIENT_TOKEN. */
export async function sendZapiText(
  phoneDigits: string,
  message: string,
  logPrefix = "[zapi]",
): Promise<ZapiSendTextResult> {
  const phone = stripToDigits(phoneDigits);
  if (!phone) {
    return { ok: false, error: "phone_empty", code: "phone_empty" };
  }

  const instanceId = Deno.env.get("ZAPI_INSTANCE_ID");
  const instanceToken = Deno.env.get("ZAPI_INSTANCE_TOKEN");
  const clientToken = Deno.env.get("ZAPI_CLIENT_TOKEN");
  if (!instanceId || !instanceToken || !clientToken) {
    console.warn(`${logPrefix} Z-API não configurada`);
    return { ok: false, error: "zapi_not_configured", code: "zapi_not_configured" };
  }

  const url = `https://api.z-api.io/instances/${instanceId}/token/${instanceToken}/send-text`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Client-Token": clientToken,
    },
    body: JSON.stringify({ phone, message }),
  });

  if (!res.ok) {
    const t = await res.text();
    console.error(`${logPrefix} send-text HTTP ${res.status}`, t);
    return { ok: false, error: t, code: "zapi_http" };
  }

  return { ok: true };
}
