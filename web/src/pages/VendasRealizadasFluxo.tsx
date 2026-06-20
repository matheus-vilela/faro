import { FluxoBoletosPage } from "@/components/fluxo/FluxoBoletosPage";
import { VENDAS_REALIZADAS_FLUXO_CONFIG } from "@/components/fluxo/fluxoBoletosConfigs";

/** Vendas realizadas no fluxo financeiro (entradas / contas a receber). */
export function VendasRealizadasFluxo() {
  return <FluxoBoletosPage config={VENDAS_REALIZADAS_FLUXO_CONFIG} />;
}
