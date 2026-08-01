import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCompany } from "@/contexts/CompanyContext";
import { supabase } from "@/lib/supabase";
import {
  accountingWeekEndsOn,
  normalizeWeekStartsOn,
  WEEKDAY_LONG_PT,
} from "@/lib/vendasRealizadasResumo";
import { CalendarRange, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

const WEEKDAY_OPTIONS = WEEKDAY_LONG_PT.map((label, value) => ({
  value,
  label,
}));

export function ConfiguracoesSemanaContabil() {
  const { currentCompany, refetchCompanies } = useCompany();
  const companyId = currentCompany?.id;

  const [weekStartsOn, setWeekStartsOn] = useState(() =>
    normalizeWeekStartsOn(currentCompany?.accounting_week_starts_on),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setWeekStartsOn(
      normalizeWeekStartsOn(currentCompany?.accounting_week_starts_on),
    );
  }, [currentCompany?.id, currentCompany?.accounting_week_starts_on]);

  const weekEndsOn = accountingWeekEndsOn(weekStartsOn);
  const dirty =
    weekStartsOn !==
    normalizeWeekStartsOn(currentCompany?.accounting_week_starts_on);

  const save = async () => {
    if (!companyId) return;
    setSaving(true);
    const { error } = await supabase
      .from("companies")
      .update({
        accounting_week_starts_on: weekStartsOn,
        updated_at: new Date().toISOString(),
      })
      .eq("id", companyId);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Semana contábil atualizada.");
    await refetchCompanies();
  };

  return (
    <PageShell className="space-y-6 pb-0">
      <PageHeader
        icon={CalendarRange}
        title="Semana contábil"
        description="Define em qual dia começa (e termina) a semana usada no resumo de vendas e em relatórios por período semanal."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dias da semana</CardTitle>
          <CardDescription>
            A semana tem sempre 7 dias. Ao escolher o início, o término é
            calculado automaticamente (6 dias depois). Ex.: quinta → quarta.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="week-start">Começa em</Label>
              <Select
                value={String(weekStartsOn)}
                onValueChange={(v) => setWeekStartsOn(Number(v))}
              >
                <SelectTrigger id="week-start">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEKDAY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={String(opt.value)}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="week-end">Termina em</Label>
              <Select
                value={String(weekEndsOn)}
                onValueChange={(v) => {
                  const end = Number(v);
                  setWeekStartsOn((end + 1) % 7);
                }}
              >
                <SelectTrigger id="week-end">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEKDAY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={String(opt.value)}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            Semana contábil:{" "}
            <span className="font-medium text-foreground">
              {WEEKDAY_LONG_PT[weekStartsOn]} → {WEEKDAY_LONG_PT[weekEndsOn]}
            </span>
          </p>

          <div className="flex justify-end">
            <Button
              type="button"
              disabled={!dirty || saving || !companyId}
              onClick={() => void save()}
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  A guardar…
                </>
              ) : (
                "Guardar"
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </PageShell>
  );
}
