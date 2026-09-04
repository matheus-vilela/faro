import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  INVENTORY_COUNT_WEEKDAY_LABELS,
  snapToWeekday,
  toDatetimeLocalValue,
  type InventoryCountRecurrenceKind,
} from "@/lib/inventoryCount/scheduleNextRun";
import { COUNT_SELECT_TRIGGER_CLASS } from "@/lib/inventoryCount/ui";
import { supabase } from "@/lib/supabase";
import type { CompanyMember } from "@/types/companyMember";
import type { InventoryCountSchedule } from "@/types/inventoryCount";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export type ScheduleDialogTarget = {
  groupId: string | null;
  listingId: string | null;
  defaultMemberId: string | null;
  title: string;
};

export function EstoqueContagemScheduleDialog({
  open,
  onOpenChange,
  companyId,
  members,
  target,
  existing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  members: CompanyMember[];
  target: ScheduleDialogTarget | null;
  existing?: InventoryCountSchedule | null;
  onSaved: () => void;
}) {
  const [nextRunLocal, setNextRunLocal] = useState("");
  const [kind, setKind] = useState<InventoryCountRecurrenceKind>("once");
  const [intervalDays, setIntervalDays] = useState("7");
  const [weekday, setWeekday] = useState(1);
  const [memberId, setMemberId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (existing) {
      setNextRunLocal(toDatetimeLocalValue(existing.next_run_at));
      setKind(existing.recurrence_kind);
      setIntervalDays(String(existing.interval_days ?? 7));
      setWeekday(existing.weekday ?? 1);
      setMemberId(existing.assigned_company_member_id ?? "");
      return;
    }
    const now = new Date();
    now.setMinutes(0, 0, 0);
    now.setHours(now.getHours() + 1);
    setNextRunLocal(toDatetimeLocalValue(now));
    setKind("once");
    setIntervalDays("7");
    setWeekday(1);
    setMemberId(target?.defaultMemberId ?? "");
  }, [open, existing, target]);

  const save = async () => {
    if (!target) return;
    const parsed = new Date(nextRunLocal);
    if (Number.isNaN(parsed.getTime())) {
      toast.error("Informe a próxima data.");
      return;
    }
    let next = parsed;
    if (kind === "alt_weeks") {
      next = snapToWeekday(parsed, weekday);
    }
    const nDays = Math.max(1, Number.parseInt(intervalDays, 10) || 1);
    setSaving(true);
    const payload = {
      company_id: companyId,
      inventory_count_group_id: target.listingId ? target.groupId : target.groupId,
      inventory_count_listing_id: target.listingId,
      assigned_company_member_id: memberId || null,
      next_run_at: next.toISOString(),
      recurrence_kind: kind,
      interval_days: kind === "every_n_days" ? nDays : null,
      weekday: kind === "alt_weeks" ? weekday : null,
      active: true,
      updated_at: new Date().toISOString(),
    };
    const query = existing
      ? supabase
          .from("inventory_count_schedules")
          .update(payload)
          .eq("id", existing.id)
      : supabase.from("inventory_count_schedules").insert(payload);
    const { error } = await query;
    setSaving(false);
    if (error) {
      toast.error(error.message ?? "Não foi possível salvar a agenda.");
      return;
    }
    toast.success(
      existing
        ? "Agenda atualizada. Remarcar a data não gera contagem antecipada."
        : "Agenda salva. A sessão só é criada no dia.",
    );
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {existing ? "Editar agenda" : "Programar contagem"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">{target?.title}</p>
          <div className="space-y-2">
            <Label htmlFor="count-next-run">Próxima data (maleável)</Label>
            <Input
              id="count-next-run"
              type="datetime-local"
              className={COUNT_SELECT_TRIGGER_CLASS}
              value={nextRunLocal}
              onChange={(e) => setNextRunLocal(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Alterar esta data não cria o link antes da hora.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Recorrência</Label>
            <Select
              value={kind}
              onValueChange={(v) => setKind(v as InventoryCountRecurrenceKind)}
            >
              <SelectTrigger className={COUNT_SELECT_TRIGGER_CLASS}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="once">Única</SelectItem>
                <SelectItem value="every_n_days">A cada N dias</SelectItem>
                <SelectItem value="alt_weeks">
                  Semana sim / semana não
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {kind === "every_n_days" ? (
            <div className="space-y-2">
              <Label htmlFor="count-interval">Intervalo (dias)</Label>
              <Input
                id="count-interval"
                type="number"
                min={1}
                className={COUNT_SELECT_TRIGGER_CLASS}
                value={intervalDays}
                onChange={(e) => setIntervalDays(e.target.value)}
              />
            </div>
          ) : null}
          {kind === "alt_weeks" ? (
            <div className="space-y-2">
              <Label>Dia da semana</Label>
              <div className="flex flex-wrap gap-1.5">
                {INVENTORY_COUNT_WEEKDAY_LABELS.map((lb, i) => (
                  <button
                    key={lb}
                    type="button"
                    onClick={() => setWeekday(i)}
                    className={cn(
                      "h-11 min-w-[2.75rem] rounded-md border px-3 text-sm font-medium transition-colors",
                      weekday === i
                        ? "border-primary bg-primary/15 text-foreground"
                        : "border-border bg-muted/30 text-muted-foreground",
                    )}
                  >
                    {lb}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label>Operador</Label>
            <Select
              value={memberId || "__none__"}
              onValueChange={(v) => setMemberId(v === "__none__" ? "" : v)}
            >
              <SelectTrigger className={COUNT_SELECT_TRIGGER_CLASS}>
                <SelectValue placeholder="Operador da listagem" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Usar operador da lista</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button type="button" disabled={saving} onClick={() => void save()}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Salvar agenda
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
