import { EpocIntegrationCard } from "@/components/integrations/EpocIntegrationCard";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useCompany, useHasPermission } from "@/contexts/CompanyContext";
import { Plug } from "lucide-react";

export function Integracoes() {
  const { currentCompany } = useCompany();
  const companyId = currentCompany?.id;
  const canManage = useHasPermission("integracoes");

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
              Você não tem permissão para configurar integrações nesta unidade.
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
        description="Conecte sistemas externos ao Faro. As credenciais ficam vinculadas a esta empresa e visíveis apenas para quem tem permissão de integrações."
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
