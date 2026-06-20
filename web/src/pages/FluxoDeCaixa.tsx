import { Navigate } from "react-router-dom";

/** Rota legada — redireciona para Contas a pagar. */
export function FluxoDeCaixa() {
  return <Navigate to="/app/contas-a-pagar" replace />;
}
