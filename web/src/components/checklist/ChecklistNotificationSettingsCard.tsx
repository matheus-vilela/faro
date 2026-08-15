import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/lib/supabase";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

type Settings = {
  remind_before_minutes: number;
  notify_on_late: boolean;
  notify_on_critical: boolean;
  notify_on_divergence: boolean;
  enabled: boolean;
};

const defaults: Settings = {
  remind_before_minutes: 15,
  notify_on_late: true,
  notify_on_critical: true,
  notify_on_divergence: true,
  enabled: true,
};

export function ChecklistNotificationSettingsCard({
  companyId,
}: {
  companyId: string;
}) {
  const [settings, setSettings] = useState<Settings>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("checklist_notification_settings")
      .select("*")
      .eq("company_id", companyId)
      .maybeSingle();
    if (data) {
      setSettings({
        remind_before_minutes: data.remind_before_minutes ?? 15,
        notify_on_late: data.notify_on_late ?? true,
        notify_on_critical: data.notify_on_critical ?? true,
        notify_on_divergence: data.notify_on_divergence ?? true,
        enabled: data.enabled ?? true,
      });
    }
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from("checklist_notification_settings").upsert({
      company_id: companyId,
      ...settings,
      updated_at: new Date().toISOString(),
    });
    setSaving(false);
    if (error) {
      toast.error("Falha ao salvar notificações.");
      return;
    }
    toast.success("Notificações salvas (WhatsApp).");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Notificações WhatsApp</CardTitle>
        <CardDescription>
          Lembretes, atraso, item crítico e divergência de contagem.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-3">
              {(
                [
                  ["enabled", "Ativar avisos"],
                  ["notify_on_late", "Atraso no prazo"],
                  ["notify_on_critical", "Item crítico"],
                  ["notify_on_divergence", "Divergência de contagem"],
                ] as const
              ).map(([key, label]) => (
                <div
                  key={key}
                  className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/20 px-3 py-2.5"
                >
                  <Label className="leading-snug">{label}</Label>
                  <Switch
                    checked={Boolean(settings[key])}
                    onCheckedChange={(v) =>
                      setSettings((s) => ({ ...s, [key]: v }))
                    }
                  />
                </div>
              ))}
            </div>
            <Button type="button" size="sm" disabled={saving} onClick={() => void save()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
