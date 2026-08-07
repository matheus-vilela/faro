import { Navigate, useLocation } from "react-router-dom";

/** Rota legada — unificada em `/app/notas-recebimento`. */
export function Recebimento() {
  const location = useLocation();
  return (
    <Navigate
      to={`/app/notas-recebimento${location.search}${location.hash}`}
      replace
    />
  );
}
