import { Card } from "@/components/ui/card";
import { useCompany } from "@/contexts/CompanyContext";

export function Dashboard() {
  const { currentCompany } = useCompany();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Bem-vindo ao Faro{currentCompany ? ` - ${currentCompany.name}` : ""}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card></Card>
      </div>
    </div>
  );
}
