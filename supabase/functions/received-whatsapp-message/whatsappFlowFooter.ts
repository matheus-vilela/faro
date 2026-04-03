/**
 * Rodapé em mensagens finais de fluxo (WhatsApp).
 * - `registro`: quando houve confirmação/registro de despesa ou envio de link para conferência.
 * - `assistente`: erros, cancelamentos e demais respostas finais sem registro concluído.
 */
const FOOTER_REGISTRO = "\n\n_✨ Conferido e registrado com IA por Faro._";
const FOOTER_ASSISTENTE = "\n\n_✨ Conferido com assistência de IA por Faro._";

export function withFaroFlowFooter(
  message: string,
  variant: "registro" | "assistente" = "assistente",
): string {
  const suffix = variant === "registro" ? FOOTER_REGISTRO : FOOTER_ASSISTENTE;
  return `${message.trimEnd()}${suffix}`;
}
