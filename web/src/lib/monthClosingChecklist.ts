import type { MonthYear } from "@/components/MonthSelector";
import type { CategoryTotals, DreComputed } from "@/lib/dre/computeDre";
import { mapCategoryToDreBucket } from "@/lib/dre/dreMapping";
import type { CompanyCategory } from "@/types/category";

export const MONTH_CLOSING_ITEM_IDS = [
  "vendas",
  "equipe",
  "espaco",
  "impostos",
  "compras",
] as const;

export type MonthClosingItemId = (typeof MONTH_CLOSING_ITEM_IDS)[number];

export type ChecklistItemStatus =
  | "missing"
  | "pending"
  | "confirmed"
  | "no_value_confirmed";

export interface ChecklistItemState {
  id: MonthClosingItemId;
  title: string;
  amount: number;
  description: string;
  hasValue: boolean;
  status: ChecklistItemStatus;
  confirmedAt: string | null;
  confirmedBy: string | null;
}

export interface MonthClosePersistedV1 {
  version: 1;
  isClosed: boolean;
  closedAt: string | null;
  closedBy: string | null;
  reopenReason: string | null;
  lastReopenAt: string | null;
  /** Somente status por id — valores vêm sempre do DRE na montagem */
  itemSnapshots: Partial<
    Record<
      MonthClosingItemId,
      {
        status: ChecklistItemStatus;
        confirmedAt: string | null;
        confirmedBy: string | null;
      }
    >
  >;
}

export interface MonthCloseState {
  monthKey: string;
  isClosed: boolean;
  closedAt: string | null;
  closedBy: string | null;
  reopenReason: string | null;
  lastReopenAt: string | null;
}

const EPS = 0.005;

/** Palavras-chave para alocar parte das despesas fixas em “Equipe e folha”. */
const PAYROLL_RE =
  /folha|sal[aá]rio|pr[oó][- ]?labore|encargo|f[eé]rias|13[ºo°]?|inss|fgts|dctf|pis|pasep/i;

/** Palavras-chave para “Gastos com o espaço”. */
const SPACE_RE =
  /aluguel|condom[ií]nio|luz|\b[aá]gua\b|g[aá]s|manuten|internet|iptu|energia|limpeza|seguro/i;

function normName(s: string): string {
  return s.trim().toLowerCase();
}

function sumAbsFixasForPredicate(
  byCategoryId: Map<string, number>,
  categoriesById: Map<string, CompanyCategory>,
  pred: (name: string) => boolean,
  excludePred?: (name: string) => boolean,
): number {
  let s = 0;
  for (const [id, raw] of byCategoryId) {
    const c = categoriesById.get(id);
    if (!c) continue;
    if (mapCategoryToDreBucket(c) !== "DESPESAS_FIXAS") continue;
    const name = normName(c.name);
    if (excludePred?.(name)) continue;
    if (!pred(name)) continue;
    s += Math.abs(Number(raw));
  }
  return s;
}

/**
 * Deriva os valores exibidos no checklist a partir da DRE do período.
 * Despesas fixas são heurísticas por nome de categoria (o restante fica em 0 nas linhas específicas).
 */
export function deriveClosingChecklistAmounts(
  computed: DreComputed | null,
  categoryTotals: CategoryTotals,
  categories: CompanyCategory[],
): Record<MonthClosingItemId, number> {
  const categoriesById = new Map(categories.map((c) => [c.id, c]));

  const vendas = computed?.vendasLiquidas ?? 0;
  const impostos = computed?.impostos ?? 0;
  const compras = computed?.cmv ?? 0;

  const byId = categoryTotals.byCategoryId;

  const equipe = sumAbsFixasForPredicate(byId, categoriesById, (n) => PAYROLL_RE.test(n));
  const espaco = sumAbsFixasForPredicate(
    byId,
    categoriesById,
    (n) => SPACE_RE.test(n),
    (n) => PAYROLL_RE.test(n),
  );

  return {
    vendas,
    equipe,
    espaco,
    impostos,
    compras,
  };
}

export function monthKeyFromPeriod(p: MonthYear): string {
  const m = String(p.month).padStart(2, "0");
  return `${p.year}-${m}`;
}

export function hasMoneyValue(amount: number): boolean {
  return Math.abs(amount) >= EPS;
}

const STORAGE_PREFIX = "faro.monthClosing.v1";

export function storageKey(companyId: string, monthKey: string): string {
  return `${STORAGE_PREFIX}:${companyId}:${monthKey}`;
}

export function defaultItemStatusForAmount(amount: number): ChecklistItemStatus {
  return hasMoneyValue(amount) ? "pending" : "missing";
}

function normalizeImportedStatus(
  status: ChecklistItemStatus | undefined,
  amount: number,
): ChecklistItemStatus {
  const hv = hasMoneyValue(amount);
  if (!status) return defaultItemStatusForAmount(amount);
  if (status === "confirmed" || status === "no_value_confirmed") return status;
  if (status === "pending" && !hv) return "missing";
  if (status === "missing" && hv) return "pending";
  return status;
}

const TITLES: Record<MonthClosingItemId, string> = {
  vendas: "Vendas do mês",
  equipe: "Equipe e folha",
  espaco: "Gastos com o espaço",
  impostos: "Impostos e guias",
  compras: "Compras e insumos",
};

const DESCRIPTIONS: Record<MonthClosingItemId, string> = {
  vendas:
    "Total de vendas do período, incluindo cartão, dinheiro, PIX e apps de delivery",
  equipe: "Folha de pagamento, encargos, férias, 13º e pró-labore",
  espaco: "Aluguel, luz, água, gás, condomínio, manutenções e internet",
  impostos: "DAS, guias de impostos e taxas municipais",
  compras: "Notas de fornecedores, compras de mercadorias e matéria-prima",
};

export function buildChecklistItems(
  amounts: Record<MonthClosingItemId, number>,
  persisted: MonthClosePersistedV1 | null,
  isMonthClosed: boolean,
): ChecklistItemState[] {
  return MONTH_CLOSING_ITEM_IDS.map((id) => {
    const amount = amounts[id];
    const hv = hasMoneyValue(amount);
    const snap = persisted?.itemSnapshots[id];
    let status: ChecklistItemStatus;
    if (isMonthClosed) {
      status = hv ? "confirmed" : "no_value_confirmed";
    } else {
      status = normalizeImportedStatus(snap?.status, amount);
    }
    return {
      id,
      title: TITLES[id],
      amount,
      description: DESCRIPTIONS[id],
      hasValue: hv,
      status,
      confirmedAt: snap?.confirmedAt ?? null,
      confirmedBy: snap?.confirmedBy ?? null,
    };
  });
}

export function loadMonthClosePersisted(
  companyId: string | undefined,
  monthKey: string,
): MonthClosePersistedV1 | null {
  if (!companyId || typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey(companyId, monthKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MonthClosePersistedV1;
    if (parsed?.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveMonthClosePersisted(
  companyId: string | undefined,
  monthKey: string,
  data: MonthClosePersistedV1,
): void {
  if (!companyId || typeof window === "undefined") return;
  try {
    localStorage.setItem(storageKey(companyId, monthKey), JSON.stringify(data));
  } catch {
    /* ignore quota */
  }
}

export function countDone(items: ChecklistItemState[]): number {
  return items.filter(
    (i) => i.status === "confirmed" || i.status === "no_value_confirmed",
  ).length;
}

export function allItemsDone(items: ChecklistItemState[]): boolean {
  return countDone(items) === MONTH_CLOSING_ITEM_IDS.length;
}
