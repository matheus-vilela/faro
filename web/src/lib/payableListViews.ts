import { formatBoletoCategoryLabel } from "@/lib/boletoCategory";
import {
  companyCategoryDisplayName,
} from "@/lib/companyCategoryLabels";
import { isProjectedBoleto } from "@/lib/expenseSeriesProjection";
import {
  resolveReceiptExpenseId,
  type PayableReceiptExpense,
} from "@/lib/payableBoletoReceipt";
import type { CompanyCategory, TipoCategoria } from "@/types/category";
import type { FluxoBoletoRow } from "@/types/expenseSeries";
import type { LucideIcon } from "lucide-react";
import {
  Building2,
  Folder,
  Hand,
  MessageCircle,
  Package,
  Receipt,
  Sparkles,
  TrendingDown,
  Wallet,
  Zap,
} from "lucide-react";

export type PayableListView = "category" | "due" | "status";

export type PayableSituation =
  | "overdue"
  | "due_today"
  | "scheduled"
  | "pending";

export type PayableOrigin = "whatsapp" | "sefaz" | "automatic" | "manual";

export const PAYABLE_SITUATION_LABEL: Record<PayableSituation, string> = {
  overdue: "Vencida",
  due_today: "Vence hoje",
  scheduled: "Agendada",
  pending: "Pendente",
};

export const PAYABLE_ORIGIN_LABEL: Record<PayableOrigin, string> = {
  whatsapp: "WhatsApp",
  sefaz: "SEFAZ",
  automatic: "Automático",
  manual: "Manual",
};

export function resolvePayableSituation(
  b: Pick<FluxoBoletoRow, "due_date" | "is_projected" | "status">,
  todayYmd: string,
): PayableSituation {
  const due = String(b.due_date ?? "").slice(0, 10);
  if (due && due < todayYmd) return "overdue";
  if (due && due === todayYmd) return "due_today";
  if (isProjectedBoleto(b)) return "scheduled";
  return "pending";
}

export function resolvePayableOrigin(
  b: Pick<
    FluxoBoletoRow,
    "expense_id" | "series_master_expense_id" | "is_projected"
  >,
  expenseById: Map<string, Pick<PayableReceiptExpense, "type" | "expense_source">>,
): PayableOrigin {
  if (isProjectedBoleto(b)) return "automatic";
  const expenseId = resolveReceiptExpenseId(b);
  if (expenseId) {
    const expense = expenseById.get(expenseId);
    if (expense?.expense_source === "whatsapp") return "whatsapp";
    if (expense?.type === "nota_fiscal") return "sefaz";
  }
  return "manual";
}

export function formatCategoryPathBullet(
  boleto: Pick<FluxoBoletoRow, "category" | "company_category_id">,
  byId: Map<string, CompanyCategory>,
): string {
  return formatBoletoCategoryLabel(boleto, byId).replace(/\s*›\s*/g, " • ");
}

export function formatDueDateShort(dueYmd: string): string {
  const part = dueYmd.slice(0, 10);
  const [y, m, d] = part.split("-");
  if (!y || !m || !d) return "—";
  return `${d}/${m}`;
}

export function formatDueDateCell(
  dueYmd: string,
  todayYmd: string,
): { label: string; tone: "overdue" | "today" | "neutral" } {
  const due = dueYmd.slice(0, 10);
  const short = formatDueDateShort(due);
  if (due < todayYmd) {
    return { label: `${short} (venceu)`, tone: "overdue" };
  }
  if (due === todayYmd) {
    return { label: `Hoje, ${short}`, tone: "today" };
  }
  return { label: short, tone: "neutral" };
}

export function rootCategoryForBoleto(
  boleto: Pick<FluxoBoletoRow, "company_category_id">,
  byId: Map<string, CompanyCategory>,
): CompanyCategory | null {
  const id = boleto.company_category_id;
  if (!id) return null;
  let cur = byId.get(id);
  if (!cur) return null;
  const guard = new Set<string>();
  while (cur.parent_id && !guard.has(cur.id)) {
    guard.add(cur.id);
    const parent = byId.get(cur.parent_id);
    if (!parent) break;
    cur = parent;
  }
  return cur;
}

export function leafCategoryForBoleto(
  boleto: Pick<FluxoBoletoRow, "company_category_id">,
  byId: Map<string, CompanyCategory>,
): CompanyCategory | null {
  const id = boleto.company_category_id;
  if (!id) return null;
  return byId.get(id) ?? null;
}

export type PayableCategorySubgroup = {
  key: string;
  label: string;
  sortOrder: number;
  items: FluxoBoletoRow[];
};

export type PayableCategoryGroup = {
  key: string;
  name: string;
  tipo: TipoCategoria | null;
  sortOrder: number;
  amount: number;
  count: number;
  subgroups: PayableCategorySubgroup[];
};

export function groupPayablesByCategory(
  boletos: FluxoBoletoRow[],
  byId: Map<string, CompanyCategory>,
): PayableCategoryGroup[] {
  const groupMap = new Map<
    string,
    {
      name: string;
      tipo: TipoCategoria | null;
      sortOrder: number;
      amount: number;
      count: number;
      subgroupMap: Map<
        string,
        { label: string; sortOrder: number; items: FluxoBoletoRow[] }
      >;
    }
  >();

  for (const b of boletos) {
    const root = rootCategoryForBoleto(b, byId);
    const leaf = leafCategoryForBoleto(b, byId);
    const groupKey = root?.id ?? "outros";
    const groupName = root
      ? companyCategoryDisplayName(root)
      : "Outros";
    const subgroupKey = leaf?.id ?? (root ? `${root.id}:self` : "outros");
    const subgroupLabel = leaf
      ? companyCategoryDisplayName(leaf)
      : root
        ? companyCategoryDisplayName(root)
        : "Outros";

    let group = groupMap.get(groupKey);
    if (!group) {
      group = {
        name: groupName,
        tipo: root?.tipo ?? null,
        sortOrder: root?.sort_order ?? root?.ordem ?? 9999,
        amount: 0,
        count: 0,
        subgroupMap: new Map(),
      };
      groupMap.set(groupKey, group);
    }

    group.amount += Number(b.amount) || 0;
    group.count += 1;

    let sub = group.subgroupMap.get(subgroupKey);
    if (!sub) {
      sub = {
        label: subgroupLabel,
        sortOrder: leaf?.sort_order ?? leaf?.ordem ?? 9999,
        items: [],
      };
      group.subgroupMap.set(subgroupKey, sub);
    }
    sub.items.push(b);
  }

  const groups: PayableCategoryGroup[] = [];
  for (const [key, g] of groupMap) {
    const subgroups = [...g.subgroupMap.entries()]
      .map(([subKey, sub]) => ({
        key: subKey,
        label: sub.label,
        sortOrder: sub.sortOrder,
        items: sub.items.sort((a, b) =>
          String(a.due_date).localeCompare(String(b.due_date)),
        ),
      }))
      .sort(
        (a, b) =>
          a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, "pt-BR"),
      );

    groups.push({
      key,
      name: g.name,
      tipo: g.tipo,
      sortOrder: g.sortOrder,
      amount: g.amount,
      count: g.count,
      subgroups,
    });
  }

  return groups.sort(
    (a, b) =>
      b.amount - a.amount ||
      a.sortOrder - b.sortOrder ||
      a.name.localeCompare(b.name, "pt-BR"),
  );
}

export function sortPayablesByDueDate(
  boletos: FluxoBoletoRow[],
): FluxoBoletoRow[] {
  return [...boletos].sort((a, b) => {
    const dueCmp = String(a.due_date).localeCompare(String(b.due_date));
    if (dueCmp !== 0) return dueCmp;
    return (Number(a.amount) || 0) - (Number(b.amount) || 0);
  });
}

export function categoryTipoIcon(tipo: TipoCategoria | null): LucideIcon {
  switch (tipo) {
    case "CMV":
      return Package;
    case "FIXA":
      return Building2;
    case "IMPOSTOS":
      return Receipt;
    case "VARIAVEL":
      return TrendingDown;
    case "OPERACIONAL":
      return Wallet;
    case "INVESTIMENTOS_FINANCIAMENTOS":
      return Sparkles;
    default:
      return Folder;
  }
}

export function payableOriginIcon(origin: PayableOrigin): LucideIcon {
  switch (origin) {
    case "whatsapp":
      return MessageCircle;
    case "sefaz":
      return Zap;
    case "automatic":
      return Zap;
    case "manual":
      return Hand;
  }
}

export function boletoSupplierLabel(b: FluxoBoletoRow): string {
  return (
    b.supplier?.name?.trim() ||
    b.provider?.trim() ||
    "—"
  );
}
