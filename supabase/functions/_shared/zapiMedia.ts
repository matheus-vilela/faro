/** Download de mídia (Z-API e outros) com Client-Token quando o host for z-api.io */

export function isZApiMediaHost(hostname: string): boolean {
  return hostname.toLowerCase().includes("z-api.io");
}

export async function fetchZApiMediaBytes(
  url: string,
  accept = "application/pdf,application/octet-stream;q=0.9,image/*;q=0.8,*/*;q=0.5",
): Promise<{ ok: true; buf: Uint8Array } | { ok: false; error: string }> {
  let hostname = "";
  try {
    hostname = new URL(url).hostname;
  } catch {
    return { ok: false, error: "URL inválida." };
  }

  const headers: HeadersInit = { Accept: accept };
  const clientToken = Deno.env.get("ZAPI_CLIENT_TOKEN")?.trim();
  if (isZApiMediaHost(hostname) && clientToken) {
    (headers as Record<string, string>)["Client-Token"] = clientToken;
  } else if (isZApiMediaHost(hostname) && !clientToken) {
    console.warn(
      "[zapiMedia] host Z-API sem ZAPI_CLIENT_TOKEN — download pode falhar.",
    );
  }

  const fetchRes = await fetch(url, { headers });
  if (!fetchRes.ok) {
    return { ok: false, error: `HTTP ${fetchRes.status}` };
  }
  const buf = new Uint8Array(await fetchRes.arrayBuffer());
  return { ok: true, buf };
}
