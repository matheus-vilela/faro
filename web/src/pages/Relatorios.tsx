import { ExportReportDialog } from "@/components/reports/ExportReportDialog";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { useCompany } from "@/contexts/CompanyContext";
import {
  REPORT_GROUP_LABELS,
  visibleReports,
} from "@/lib/reports/catalog";
import type { ReportGroup, ReportId } from "@/lib/reports/types";
import { FileDown } from "lucide-react";
import { useMemo, useState } from "react";

const GROUP_ORDER: ReportGroup[] = ["financeiro", "gestao", "operacao"];

export function Relatorios() {
  const { isAdmin } = useAuth();
  const { currentPermissions, isCompanyOwner } = useCompany();
  const reports = useMemo(
    () =>
      visibleReports(currentPermissions, isCompanyOwner, Boolean(isAdmin)),
    [currentPermissions, isAdmin, isCompanyOwner],
  );
  const [open, setOpen] = useState(false);
  const [reportId, setReportId] = useState<ReportId>("payables_open");

  const grouped = GROUP_ORDER.map((group) => ({
    group,
    items: reports.filter((r) => r.group === group),
  })).filter((g) => g.items.length > 0);

  return (
    <PageShell>
      <PageHeader
        title="Relatórios"
        description="Exporte CSV, Excel ou PDF com filtros por período, situação e categoria."
        icon={FileDown}
      />

      {grouped.map(({ group, items }) => (
        <section key={group} className="space-y-3">
          <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            {REPORT_GROUP_LABELS[group]}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {items.map((r) => (
              <Card key={r.id}>
                <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <CardTitle className="text-base">{r.title}</CardTitle>
                    <CardDescription>{r.description}</CardDescription>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    onClick={() => {
                      setReportId(r.id);
                      setOpen(true);
                    }}
                  >
                    Exportar
                  </Button>
                </CardHeader>
              </Card>
            ))}
          </div>
        </section>
      ))}

      <ExportReportDialog
        open={open}
        onOpenChange={setOpen}
        reportId={reportId}
        lockReport
      />
    </PageShell>
  );
}
