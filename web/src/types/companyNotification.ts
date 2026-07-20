export type CompanyNotificationRule =
  | "bill_due_alerts"
  | "weekly_summary";

export type CompanyNotificationEntry = {
  number: string;
  rules: CompanyNotificationRule[];
};

export function parseCompanyNotification(
  raw: unknown,
): CompanyNotificationEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: CompanyNotificationEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const number = String(o.number ?? "").replace(/\D/g, "");
    if (!number) continue;
    const rulesRaw = o.rules;
    const rules: CompanyNotificationEntry["rules"] = [];
    if (Array.isArray(rulesRaw)) {
      for (const r of rulesRaw) {
        if (r === "bill_due_alerts" || r === "weekly_summary") rules.push(r);
      }
    }
    out.push({ number, rules });
  }
  return out;
}

export const NOTIFICATION_RULE_LABELS: Record<
  CompanyNotificationRule,
  { title: string; description: string }
> = {
  bill_due_alerts: {
    title: "Avisar contas 3 dias antes do vencimento",
    description:
      "E de novo na véspera. Chega de multa por esquecimento.",
  },
  weekly_summary: {
    title: "Resumo toda segunda, 8h",
    description:
      "Vendas, contas da semana e CMV. Direto no seu celular.",
  },
};
