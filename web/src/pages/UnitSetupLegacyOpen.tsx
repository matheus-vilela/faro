import { useUnitSetupModal } from "@/contexts/UnitSetupModalContext";
import { useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

/**
 * Abre o assistente no modal e redireciona para o app (links antigos
 * `/empresas/unidade/setup` ainda funcionam).
 */
export function UnitSetupLegacyOpen() {
  const { companyId } = useParams<{ companyId: string }>();
  const [searchParams] = useSearchParams();
  const { openModal } = useUnitSetupModal();
  const navigate = useNavigate();

  useEffect(() => {
    const groupId = searchParams.get("groupId");
    if (companyId) {
      openModal({ kind: "resume", companyId });
    } else if (groupId) {
      openModal({ kind: "add_unit", groupId });
    } else {
      openModal({ kind: "new_group" });
    }
    navigate("/app", { replace: true });
  }, [companyId, searchParams, openModal, navigate]);

  return null;
}
