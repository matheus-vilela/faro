import { EpocIntegrationCard } from "@/components/integrations/EpocIntegrationCard";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useCompany } from "@/contexts/CompanyContext";
import { canGestorAccess } from "@/lib/roles";
import { Plug } from "lucide-react";

export function Integracoes() {
  const { currentCompany, currentRole } = useCompany();
  const companyId = currentCompany?.id;
  const canManage = currentRole ? canGestorAccess(currentRole) : false;

  if (!canManage) {
    return (
      <PageShell className="space-y-8" narrow>
        <PageHeader
          title="Integrações"
          description="Conecte sistemas externos ao Faro"
          icon={Plug}
        />
        <Card>
          <CardHeader>
            <CardTitle>Acesso restrito</CardTitle>
            <CardDescription>
              Apenas gestores e proprietários configuram integrações.
            </CardDescription>
          </CardHeader>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell className="space-y-8" narrow>
      <PageHeader
        title="Integrações"
        description="Conecte sistemas externos ao Faro. As credenciais ficam vinculadas a esta empresa e visíveis apenas para gestores e proprietários."
        icon={Plug}
      />

      {companyId ? (
        <div className="space-y-6">
          <EpocIntegrationCard companyId={companyId} />
        </div>
      ) : null}
    </PageShell>
  );
}
