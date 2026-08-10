import { Button } from "@/components/ui/button";
import { useCompany, useHasPermission } from "@/contexts/CompanyContext";
import {
  fetchDashboardImportReviewEpocRecipesNoIngredients,
  fetchDashboardImportReviewPendingRevenueLink,
} from "@/lib/dashboardImportReview";
import { fetchPurchaseWithoutUtilCount } from "@/lib/onboardingProductRecipeMatch";
import {
  computePurchasesDashboardCounts,
  purchasesMetricProductsHref,
  type PurchasesDashboardCounts,
  type PurchasesDashboardMetric,
} from "@/lib/productPurchasesDashboard";
import { fetchAllInRange } from "@/lib/supabaseFetchAll";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { Product } from "@/types/product";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  ChefHat,
  CircleDollarSign,
  Clock,
  Loader2,
  Package,
  TriangleAlert,
  UtensilsCrossed,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

type MetricCardConfig = {
  metric: PurchasesDashboardMetric;
  countKey: keyof PurchasesDashboardCounts;
  label: string;
  hint: string;
  icon: LucideIcon;
};

const METRIC_CARDS: MetricCardConfig[] = [
  {
    metric: "critical",
    countKey: "criticalStock",
    label: "Estoque crítico",
    hint: "Saldo ≤ 20% do estoque mínimo",
    icon: TriangleAlert,
  },
  {
    metric: "no_price",
    countKey: "withoutPrice",
    label: "Sem preço",
    hint: "Sem valor na última entrada ou custo médio",
    icon: CircleDollarSign,
  },
  {
    metric: "no_min",
    countKey: "withoutMinStock",
    label: "Sem estoque mínimo",
    hint: "Mínimo não configurado no cadastro",
    icon: Package,
  },
  {
    metric: "stale_price",
    countKey: "stalePrice",
    label: "Preço desatualizado",
    hint: "Sem atualização de preço há ~2 meses",
    icon: Clock,
  },
];

function PurchasesPulseTile({
  icon: Icon,
  label,
  count,
  hint,
  loading,
  href,
  linkLabel = "Produtos",
}: {
  icon: LucideIcon;
  label: string;
  count: number;
  hint: string;
  loading: boolean;
  href: string;
  linkLabel?: string;
}) {
  const hasItems = count > 0;
  const tone = hasItems ? "amber" : "muted";

  return (
    <div
      className={cn(
        "flex flex-col justify-between gap-2 rounded-xl border p-3 shadow-sm",
        tone === "amber"
          ? "border-amber-500/35 bg-amber-500/[0.07] dark:bg-amber-500/10"
          : "border-border/80 bg-card",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
              tone === "amber"
                ? "bg-amber-500/15 text-amber-800 dark:text-amber-400"
                : "bg-muted text-muted-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {label}
            </p>
            {loading ? (
              <Loader2 className="mt-1 h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <p
                className={cn(
                  "text-2xl font-bold tabular-nums leading-tight tracking-tight",
                  hasItems && "text-amber-900 dark:text-amber-100",
                  !hasItems && "text-muted-foreground",
                )}
              >
                {count}
              </p>
            )}
          </div>
        </div>
        {!loading ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 px-2 text-xs"
            asChild
          >
            <Link to={href}>
              {linkLabel}
              <ArrowRight className="ml-1 h-3 w-3" />
            </Link>
          </Button>
        ) : null}
      </div>
      {!loading && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

export function DashboardPurchasesSection() {
  const { currentCompany } = useCompany();
  const companyId = currentCompany?.id;
  const canSeeAlerts = useHasPermission("alertas");
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<PurchasesDashboardCounts>({
    criticalStock: 0,
    withoutPrice: 0,
    withoutMinStock: 0,
    stalePrice: 0,
  });
  const [withoutUtilCount, setWithoutUtilCount] = useState(0);
  const [fichasPendentesCount, setFichasPendentesCount] = useState(0);

  const loadCounts = useCallback(async () => {
    if (!companyId) {
      setCounts({
        criticalStock: 0,
        withoutPrice: 0,
        withoutMinStock: 0,
        stalePrice: 0,
      });
      setWithoutUtilCount(0);
      setFichasPendentesCount(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [rows, withoutUtil, step1, step2] = await Promise.all([
        fetchAllInRange<
          Pick<
            Product,
            | "min_quantity"
            | "current_quantity"
            | "last_unit_value"
            | "last_unit_value_stock"
            | "average_cost"
            | "updated_at"
          >
        >(
          supabase
            .from("products")
            .select(
              "min_quantity, current_quantity, last_unit_value, last_unit_value_stock, average_cost, updated_at",
            )
            .eq("company_id", companyId)
            .eq("listed_in_product_catalog", true)
            .or("is_active.is.null,is_active.eq.true"),
        ),
        fetchPurchaseWithoutUtilCount(supabase, companyId),
        canSeeAlerts
          ? fetchDashboardImportReviewEpocRecipesNoIngredients(
              supabase,
              companyId,
            )
          : Promise.resolve({ rows: [], error: null }),
        canSeeAlerts
          ? fetchDashboardImportReviewPendingRevenueLink(supabase, companyId)
          : Promise.resolve({ rows: [], error: null }),
      ]);
      setCounts(computePurchasesDashboardCounts(rows));
      if (withoutUtil.error) {
        console.error(withoutUtil.error);
        setWithoutUtilCount(0);
      } else {
        setWithoutUtilCount(withoutUtil.count);
      }
      const fichas =
        (step1.error ? 0 : step1.rows.length) +
        (step2.error ? 0 : step2.rows.length);
      setFichasPendentesCount(fichas);
    } catch (e) {
      console.error(e);
      setCounts({
        criticalStock: 0,
        withoutPrice: 0,
        withoutMinStock: 0,
        stalePrice: 0,
      });
      setWithoutUtilCount(0);
      setFichasPendentesCount(0);
    }
    setLoading(false);
  }, [canSeeAlerts, companyId]);

  useEffect(() => {
    queueMicrotask(() => void loadCounts());
  }, [loadCounts]);

  if (!companyId) return null;

  return (
    <section aria-label="Compras" className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Compras</h2>
          <p className="text-xs text-muted-foreground">
            Catálogo — indicadores para lista de compras e revisão de cadastro
          </p>
        </div>
        <Button variant="outline" size="sm" className="shrink-0" asChild>
          <Link to="/app/produtos">
            Produtos e estoque
            <ArrowRight className="ml-1 h-4 w-4" />
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {METRIC_CARDS.map((card) => (
          <PurchasesPulseTile
            key={card.metric}
            icon={card.icon}
            label={card.label}
            count={counts[card.countKey]}
            hint={card.hint}
            loading={loading}
            href={purchasesMetricProductsHref(card.metric)}
          />
        ))}
        {!loading && withoutUtilCount > 0 ? (
          <PurchasesPulseTile
            icon={UtensilsCrossed}
            label="Sem vínculo"
            count={withoutUtilCount}
            hint="Compra só entrada sem ficha/utilização"
            loading={false}
            href="/app/produtos?aba=vinculos"
            linkLabel="Vincular"
          />
        ) : null}
        {!loading && canSeeAlerts && fichasPendentesCount > 0 ? (
          <PurchasesPulseTile
            icon={ChefHat}
            label="Fichas pendentes"
            count={fichasPendentesCount}
            hint="Candidatos a ficha técnica ou vendas a ligar"
            loading={false}
            href="/app/produtos?aba=fichas"
            linkLabel="Revisar"
          />
        ) : null}
      </div>
    </section>
  );
}
