import { FluxoBoletosPage } from "@/components/fluxo/FluxoBoletosPage";
import { CONTAS_A_PAGAR_FLUXO_CONFIG } from "@/components/fluxo/fluxoBoletosConfigs";

export function ContasAPagar() {
  return <FluxoBoletosPage config={CONTAS_A_PAGAR_FLUXO_CONFIG} />;
}
