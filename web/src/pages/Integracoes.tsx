import { EpocIntegrationCard } from "@/components/integrations/EpocIntegrationCard";
import { FiscalIntegrationCard } from "@/components/integrations/FiscalIntegrationCard";
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
      <PageShell className="space-y-8 pb-0">
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
    <PageShell className="space-y-8 pb-0">
      <PageHeader
        title="Integrações"
        description="Conecte sistemas externos ao Faro. As credenciais ficam vinculadas a esta empresa e visíveis apenas para quem tem permissão de integrações."
        icon={Plug}
      />

      {companyId ? (
        <div className="flex w-full flex-wrap gap-3">
          <div className="min-w-0 w-full max-w-[350px] flex-1 basis-[min(100%,250px)]">
            <FiscalIntegrationCard companyId={companyId} />
          </div>
          <div className="min-w-0 w-full max-w-[350px] flex-1 basis-[min(100%,250px)]">
            <EpocIntegrationCard companyId={companyId} />
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}
