import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  applyWhatsappPhoneMaskChange,
  maskWhatsappBrInput,
} from "@/lib/whatsappPhone";
import { cn } from "@/lib/utils";
import {
  NOTIFICATION_RULE_LABELS,
  type CompanyNotificationRule,
} from "@/types/companyNotification";
import { AlarmClock, BarChart3, Check } from "lucide-react";

const RULE_OPTIONS: {
  rule: CompanyNotificationRule;
  icon: typeof AlarmClock;
}[] = [
  { rule: "bill_due_alerts", icon: AlarmClock },
  { rule: "weekly_summary", icon: BarChart3 },
];

export function StepWhatsappForm({
  phoneDigits,
  rules,
  onPhoneChange,
  onRuleToggle,
}: {
  phoneDigits: string;
  rules: CompanyNotificationRule[];
  onPhoneChange: (digits: string) => void;
  onRuleToggle: (rule: CompanyNotificationRule) => void;
}) {
  const maskedPhone = maskWhatsappBrInput(phoneDigits);

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="whatsapp-phone">Seu WhatsApp</Label>
        <Input
          id="whatsapp-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="(11) 98765-4321"
          value={maskedPhone}
          onChange={(e) =>
            onPhoneChange(
              applyWhatsappPhoneMaskChange(phoneDigits, e.target.value),
            )
          }
        />
      </div>

      <div className="space-y-3">
        {RULE_OPTIONS.map(({ rule, icon: Icon }) => {
          const selected = rules.includes(rule);
          const meta = NOTIFICATION_RULE_LABELS[rule];
          return (
            <Card
              key={rule}
              className={cn(
                "overflow-hidden transition-shadow",
                selected
                  ? "border-primary ring-1 ring-primary/20 bg-primary/5"
                  : "border-border/80",
              )}
            >
              <button
                type="button"
                onClick={() => onRuleToggle(rule)}
                className={cn(
                  "flex w-full items-start gap-4 p-4 text-left transition-colors sm:p-5",
                  "hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                )}
                aria-pressed={selected}
              >
                <div
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border",
                    selected
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-muted/50 text-muted-foreground",
                  )}
                >
                  <Icon className="h-5 w-5" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground sm:text-base">
                    {meta.title}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {meta.description}
                  </p>
                </div>
                {selected ? (
                  <Check
                    className="h-5 w-5 shrink-0 text-primary"
                    aria-hidden
                  />
                ) : null}
              </button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
