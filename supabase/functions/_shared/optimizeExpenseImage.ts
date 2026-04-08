/**
 * Redimensiona e comprime JPEG para armazenamento (Edge/Deno).
 * O runtime das Edge Functions não inclui binários nativos do `sharp`; usamos ImageScript
 * com perfil semelhante (largura máx. + qualidade JPEG).
 */
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";

const MAX_WIDTH = 1600;
const JPEG_QUALITY = 78;

export async function optimizeExpenseImage(
  input: Uint8Array,
): Promise<{ bytes: Uint8Array; mime: "image/jpeg" }> {
  let img: Image;
  try {
    img = await Image.decode(input);
  } catch (e) {
    console.error("[optimizeExpenseImage] decode:", e);
    throw new Error("Não foi possível decodificar a imagem.");
  }

  if (img.width > MAX_WIDTH) {
    const h = Math.max(1, Math.round((img.height * MAX_WIDTH) / img.width));
    img.resize(MAX_WIDTH, h);
  }

  const encoded = await img.encodeJPEG(JPEG_QUALITY);
  const bytes = encoded instanceof Uint8Array
    ? encoded
    : new Uint8Array(encoded);

  return { bytes, mime: "image/jpeg" };
}

/** Evita estouro de stack em imagens grandes */
export function bytesToImageDataUrlSafe(
  bytes: Uint8Array,
  mime: "image/jpeg" | "image/png" | "image/webp",
): string {
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunk) as unknown as number[],
    );
  }
  return `data:${mime};base64,${btoa(binary)}`;
}
