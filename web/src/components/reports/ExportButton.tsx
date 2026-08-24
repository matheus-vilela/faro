import { Button } from "@/components/ui/button";
import { ExportReportDialog } from "@/components/reports/ExportReportDialog";
import { cn } from "@/lib/utils";
import type { ProductExportFilterState } from "@/lib/productCatalogFilters";
import type { ReportFilterState, ReportId } from "@/lib/reports/types";
import { Download } from "lucide-react";
import { useState, type ReactNode } from "react";

export function ExportButton({
  reportId,
  allowedReportIds,
  initialFilters,
  stockFilters,
  lockReport = true,
  className,
  label = "Exportar",
}: {
  reportId: ReportId;
  allowedReportIds?: ReportId[];
  initialFilters?: Partial<ReportFilterState>;
  stockFilters?: ProductExportFilterState;
  lockReport?: boolean;
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn("h-10 shrink-0 gap-1.5", className)}
        onClick={() => setOpen(true)}
      >
        <Download className="h-4 w-4" />
        {label}
      </Button>
      <ExportReportDialog
        open={open}
        onOpenChange={setOpen}
        reportId={reportId}
        allowedReportIds={allowedReportIds}
        initialFilters={initialFilters}
        stockFilters={stockFilters}
        lockReport={lockReport}
      />
    </>
  );
}

export function HeaderExportActions({
  exportSlot,
  primary,
}: {
  exportSlot: ReactNode;
  primary?: ReactNode;
}) {
  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
      {exportSlot}
      {primary}
    </div>
  );
}
