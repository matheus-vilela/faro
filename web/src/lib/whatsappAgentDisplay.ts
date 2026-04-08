/**
 * Número ou texto de exibição do agente WhatsApp Faro (mesmo contato para todas as empresas).
 * Configure no build: `VITE_FARO_WHATSAPP_AGENT_DISPLAY` (ex.: +55 11 99999-9999).
 */
export const FARO_WHATSAPP_AGENT_DISPLAY_DEFAULT = "+55 11 917589292";

export function getWhatsappAgentDisplayLabel(): string {
  const raw = import.meta.env.VITE_FARO_WHATSAPP_AGENT_DISPLAY as
    | string
    | undefined;
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed || FARO_WHATSAPP_AGENT_DISPLAY_DEFAULT;
}

/** Link wa.me a partir do rótulo (apenas dígitos). */
export function getWhatsappAgentWaMeHref(): string {
  const label = getWhatsappAgentDisplayLabel();
  const digits = label.replace(/\D/g, "");
  if (!digits) {
    return `https://wa.me/${FARO_WHATSAPP_AGENT_DISPLAY_DEFAULT.replace(/\D/g, "")}`;
  }
  return `https://wa.me/${digits}`;
}
