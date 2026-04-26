import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useCompany } from "@/contexts/CompanyContext";
import { useUnitSetupModal } from "@/contexts/UnitSetupModalContext";
import { normalizeSetupMap } from "@/services/unitSetupService";
import { useMemo } from "react";
import { ClipboardList } from "lucide-react";

export function SetupProgressCard() {
  const { currentCompany } = useCompany();
  const { openModal } = useUnitSetupModal();

  const show = useMemo(() => {
    if (!currentCompany?.setup) return false;
    const s = normalizeSetupMap(currentCompany.setup);
    return s.status === "in_progress" || s.status === "paused";
  }, [currentCompany?.setup]);

  if (!currentCompany || !show) return null;

  const s = normalizeSetupMap(currentCompany.setup);
  const pct = Math.round(s.progress_percent ?? 0);
  const step = s.current_step ?? 1;

  return (
    <Card className="border-amber-500/40 bg-amber-500/5">
      <CardHeader className="pb-2">
        <div className="flex items-start gap-3">
          <ClipboardList className="mt-0.5 h-5 w-5 text-amber-700 dark:text-amber-400" />
          <div className="min-w-0 flex-1 space-y-1">
            <CardTitle className="text-base">Setup em andamento</CardTitle>
            <CardDescription>
              Etapa atual: {step} de 4 · {pct}% concluído
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() =>
            openModal({ kind: "resume", companyId: currentCompany.id })
          }
        >
          Retomar setup
        </Button>
      </CardContent>
    </Card>
  );
}
