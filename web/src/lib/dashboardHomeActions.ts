import {
  purchasesMetricProductsHref,
  type PurchasesDashboardCounts,
} from "@/lib/productPurchasesDashboard";
import type { CompanyAlertKind, CompanyAlertRow } from "@/types/companyAlert";

export type HomeActionTone = "danger" | "warning" | "info" | "amber";

export type HomeActionPriority = "critical" | "high" | "medium" | "low";

export type HomeActionCta = {
  label: string;
  href?: string;
  /** Identificador para ações inline (ex.: aprovar despesa WhatsApp). */
  action?: "approve_whatsapp" | "open_whatsapp";
  expenseId?: string;
};

export type HomeActionItem = {
  id: string;
  priority: HomeActionPriority;
  tone: HomeActionTone;
  title: string;
  subtitle: string;
  primary: HomeActionCta;
  secondary?: HomeActionCta;
};

const PRIORITY_ORDER: Record<HomeActionPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const KIND_HREF: Record<CompanyAlertKind, string> = {
  low_stock: "/app/alertas?kind=low_stock",
  expense_no_boleto: "/app/alertas?kind=expense_no_boleto",
  recebimento_falta: "/app/alertas?kind=recebimento_falta",
  boleto_vencimento_d3: "/app/alertas?kind=boleto_vencimento_d3",
  boleto_vencimento_d1: "/app/alertas?kind=boleto_vencimento_d1",
  import_pending_review: "/app/alertas?kind=import_pending_review",
};

const KIND_TONE: Record<CompanyAlertKind, HomeActionTone> = {
  low_stock: "danger",
  expense_no_boleto: "warning",
  recebimento_falta: "warning",
  boleto_vencimento_d3: "warning",
  boleto_vencimento_d1: "danger",
  import_pending_review: "info",
};

function toneDotClass(tone: HomeActionTone): string {
  switch (tone) {
    case "danger":
      return "bg-destructive";
    case "warning":
      return "bg-amber-500";
    case "info":
      return "bg-sky-500";
    case "amber":
    default:
      return "bg-amber-500";
  }
}

export { toneDotClass };

function formatBrl(amount: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(amount);
}

export type WhatsappPendingExpense = {
  id: string;
  supplier_name: string | null;
  amount: number;
};

export type BuildHomeActionsInput = {
  canSeeAlerts: boolean;
  isOwner: boolean;
  whatsappPending: WhatsappPendingExpense[];
  payablesTodayCount: number;
  payablesTodayAmount: number;
  payablesTomorrowCount: number;
  payablesTomorrowAmount: number;
  fichasPendentesCount: number;
  withoutUtilCount: number;
  purchases: PurchasesDashboardCounts;
  openAlerts: Pick<
    CompanyAlertRow,
    "id" | "kind" | "severity" | "title" | "message" | "link_path"
  >[];
};

export function buildHomeActionItems(
  input: BuildHomeActionsInput,
): HomeActionItem[] {
  const items: HomeActionItem[] = [];

  if (input.isOwner) {
    for (const exp of input.whatsappPending.slice(0, 3)) {
      const name = exp.supplier_name?.trim() || "Fornecedor";
      items.push({
        id: `whatsapp-${exp.id}`,
        priority: "high",
        tone: "amber",
        title: `Aprovar despesa · ${name}`,
        subtitle: `${formatBrl(exp.amount)} · enviada pelo WhatsApp`,
        primary: {
          label: "Aprovar",
          action: "approve_whatsapp",
          expenseId: exp.id,
        },
        secondary: {
          label: "Ver",
          action: "open_whatsapp",
          expenseId: exp.id,
        },
      });
    }
    if (input.whatsappPending.length > 3) {
      const rest = input.whatsappPending.length - 3;
      items.push({
        id: "whatsapp-more",
        priority: "high",
        tone: "amber",
        title: `Mais ${rest} nota${rest === 1 ? "" : "s"} WhatsApp pendente${rest === 1 ? "" : "s"}`,
        subtitle: "Aguardando sua aprovação para liberar o recebimento",
        primary: {
          label: "Ver notas",
          href: "/app/notas-recebimento",
        },
      });
    }
  }

  const dueSoonCount =
    input.payablesTodayCount + input.payablesTomorrowCount;
  const dueSoonAmount =
    input.payablesTodayAmount + input.payablesTomorrowAmount;
  if (dueSoonCount > 0) {
    const parts: string[] = [];
    if (input.payablesTodayCount > 0) {
      parts.push(
        `${input.payablesTodayCount} hoje (${formatBrl(input.payablesTodayAmount)})`,
      );
    }
    if (input.payablesTomorrowCount > 0) {
      parts.push(
        `${input.payablesTomorrowCount} amanhã (${formatBrl(input.payablesTomorrowAmount)})`,
      );
    }
    items.push({
      id: "payables-due-soon",
      priority: input.payablesTodayCount > 0 ? "high" : "high",
      tone: input.payablesTodayCount > 0 ? "danger" : "warning",
      title:
        dueSoonCount === 1
          ? "1 conta vence em breve"
          : `${dueSoonCount} contas vencem em breve`,
      subtitle: `${parts.join(" · ")} · total ${formatBrl(dueSoonAmount)}`,
      primary: { label: "Ver contas", href: "/app/contas-a-pagar" },
    });
  }

  if (input.canSeeAlerts && input.fichasPendentesCount > 0) {
    items.push({
      id: "fichas-pendentes",
      priority: "medium",
      tone: "amber",
      title:
        input.fichasPendentesCount === 1
          ? "1 ficha pendente"
          : `${input.fichasPendentesCount} fichas pendentes`,
      subtitle: "Candidatos a ficha técnica ou vendas a ligar à receita",
      primary: { label: "Revisar", href: "/app/produtos?aba=fichas" },
    });
  }

  if (input.withoutUtilCount > 0) {
    items.push({
      id: "sem-vinculo",
      priority: "medium",
      tone: "info",
      title:
        input.withoutUtilCount === 1
          ? "1 produto sem vínculo"
          : `${input.withoutUtilCount} produtos sem vínculo`,
      subtitle: "Compra só de entrada sem ficha/utilização — afeta a margem",
      primary: { label: "Resolver", href: "/app/produtos?aba=vinculos" },
    });
  }

  if (input.purchases.criticalStock > 0) {
    items.push({
      id: "estoque-critico",
      priority: "medium",
      tone: "danger",
      title:
        input.purchases.criticalStock === 1
          ? "1 produto com estoque crítico"
          : `${input.purchases.criticalStock} produtos com estoque crítico`,
      subtitle: "Saldo ≤ 20% do estoque mínimo",
      primary: {
        label: "Ver produtos",
        href: purchasesMetricProductsHref("critical"),
      },
    });
  }

  if (input.purchases.withoutPrice > 0) {
    items.push({
      id: "sem-preco",
      priority: "medium",
      tone: "warning",
      title:
        input.purchases.withoutPrice === 1
          ? "1 produto sem preço"
          : `${input.purchases.withoutPrice} produtos sem preço`,
      subtitle: "Sem valor na última entrada ou custo médio",
      primary: {
        label: "Corrigir",
        href: purchasesMetricProductsHref("no_price"),
      },
    });
  }

  if (input.purchases.stalePrice > 0) {
    items.push({
      id: "preco-desatualizado",
      priority: "low",
      tone: "warning",
      title:
        input.purchases.stalePrice === 1
          ? "1 preço desatualizado"
          : `${input.purchases.stalePrice} preços desatualizados`,
      subtitle: "Sem atualização de preço há ~2 meses",
      primary: {
        label: "Revisar",
        href: purchasesMetricProductsHref("stale_price"),
      },
    });
  }

  if (input.purchases.withoutMinStock > 0) {
    items.push({
      id: "sem-minimo",
      priority: "low",
      tone: "info",
      title:
        input.purchases.withoutMinStock === 1
          ? "1 produto sem estoque mínimo"
          : `${input.purchases.withoutMinStock} produtos sem estoque mínimo`,
      subtitle: "Mínimo não configurado no cadastro",
      primary: {
        label: "Configurar",
        href: purchasesMetricProductsHref("no_min"),
      },
    });
  }

  const skipKinds = new Set<CompanyAlertKind>();
  if (dueSoonCount > 0) {
    skipKinds.add("boleto_vencimento_d1");
    skipKinds.add("boleto_vencimento_d3");
  }
  if (input.purchases.criticalStock > 0) {
    skipKinds.add("low_stock");
  }

  const alertByKind = new Map<CompanyAlertKind, typeof input.openAlerts>();
  for (const a of input.openAlerts) {
    if (skipKinds.has(a.kind)) continue;
    const list = alertByKind.get(a.kind) ?? [];
    list.push(a);
    alertByKind.set(a.kind, list);
  }

  for (const [kind, list] of alertByKind) {
    const first = list[0];
    if (!first) continue;
    const tone =
      first.severity === "danger"
        ? ("danger" as const)
        : first.severity === "info"
          ? ("info" as const)
          : (KIND_TONE[kind] ?? "warning");
    const href = first.link_path?.trim() || KIND_HREF[kind];
    items.push({
      id: `alert-${kind}`,
      priority: first.severity === "danger" ? "high" : "medium",
      tone,
      title:
        list.length === 1
          ? first.title
          : `${list.length} alertas · ${first.title}`,
      subtitle:
        first.message?.trim() ||
        "Abra a central de alertas para ver os detalhes",
      primary: { label: "Resolver", href },
    });
  }

  return items.sort(
    (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority],
  );
}

export function buildHomeInsightText(input: {
  periodLabel: string;
  faturamento: number;
  faturamentoDeltaPct: number | null;
  actionCount: number;
}): string {
  const fat = formatBrl(input.faturamento);
  const delta =
    input.faturamentoDeltaPct != null
      ? ` (${input.faturamentoDeltaPct > 0 ? "+" : ""}${input.faturamentoDeltaPct.toLocaleString(
          "pt-BR",
          { maximumFractionDigits: 0 },
        )}% vs período anterior)`
      : "";

  if (input.actionCount < 0) {
    return `Seu faturamento ${input.periodLabel} está em ${fat}${delta}. Estou checando o que precisa de você…`;
  }

  if (input.actionCount <= 0) {
    return `Seu faturamento ${input.periodLabel} está em ${fat}${delta}. Nada pendente agora — eu te aviso quando surgir algo.`;
  }

  const n = input.actionCount;
  return `Seu faturamento ${input.periodLabel} está em ${fat}${delta}. Deixei ${n} coisa${n === 1 ? "" : "s"} esperando você ali embaixo — alguns minutos e tá tudo em dia.`;
}

export function greetingForHour(now = new Date()): string {
  const hour = Number(
    now.toLocaleString("en-US", {
      timeZone: "America/Sao_Paulo",
      hour: "numeric",
      hour12: false,
    }),
  );
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

export function firstNameFromUser(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
} | null): string {
  const meta = user?.user_metadata ?? {};
  const full = String(meta.full_name ?? meta.name ?? "").trim();
  if (full) return full.split(/\s+/)[0] ?? full;
  const email = user?.email?.trim() ?? "";
  if (email.includes("@")) return email.split("@")[0] ?? "por aí";
  return "por aí";
}
