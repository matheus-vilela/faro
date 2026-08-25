import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import {
  PRODUCT_CATALOG_PATH,
  PRODUCT_HOME_PATH,
  STOCK_COUNT_PATH,
  STOCK_LEDGER_PATH,
  STOCK_PURCHASES_PATH,
  RECIPES_PATH,
  RECIPES_PENDING_PATH,
  RECIPES_MATCH_PATH,
  SERVICES_PATH,
} from "@/lib/productStockPaths";
import { cn } from "@/lib/utils";
import {
  ChefHat,
  ClipboardList,
  ConciergeBell,
  Home,
  Inbox,
  Package,
  ShoppingCart,
  SlidersHorizontal,
  UtensilsCrossed,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

type StockLink = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
};

const STOCK_GROUPS: {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  links: StockLink[];
}[] = [
  {
    id: "inicio",
    label: "Início",
    description: "Insights e setup",
    icon: Home,
    links: [
      {
        to: PRODUCT_HOME_PATH,
        label: "Início",
        icon: Home,
        end: true,
      },
    ],
  },
  {
    id: "catalogo",
    label: "Catálogo",
    description: "Cadastro e saldos",
    icon: Package,
    links: [
      {
        to: PRODUCT_CATALOG_PATH,
        label: "Catálogo",
        icon: Package,
        end: true,
      },
    ],
  },
  {
    id: "estoque",
    label: "Estoque",
    description: "Movimentações e compras",
    icon: Warehouse,
    links: [
      {
        to: STOCK_LEDGER_PATH,
        label: "Movimentações",
        icon: SlidersHorizontal,
        end: true,
      },
      {
        to: STOCK_PURCHASES_PATH,
        label: "Pedidos de compra",
        icon: ShoppingCart,
      },
    ],
  },
  {
    id: "contagem",
    label: "Contagem",
    description: "Inventário físico",
    icon: ClipboardList,
    links: [
      {
        to: STOCK_COUNT_PATH,
        label: "Contagem",
        icon: ClipboardList,
      },
    ],
  },
  {
    id: "fichas",
    label: "Fichas técnicas",
    description: "Receitas e pendências",
    icon: ChefHat,
    links: [
      {
        to: RECIPES_PATH,
        label: "Fichas",
        icon: ChefHat,
        end: true,
      },
      {
        to: RECIPES_PENDING_PATH,
        label: "Pendentes",
        icon: Inbox,
      },
      {
        to: RECIPES_MATCH_PATH,
        label: "Vincular compras",
        icon: UtensilsCrossed,
      },
    ],
  },
  {
    id: "servicos",
    label: "Serviços",
    description: "Cadastro sem estoque",
    icon: ConciergeBell,
    links: [
      {
        to: SERVICES_PATH,
        label: "Serviços",
        icon: ConciergeBell,
      },
    ],
  },
];

function linkMatches(pathname: string, link: StockLink): boolean {
  if (link.end) {
    return pathname === link.to || pathname === `${link.to}/`;
  }
  return pathname === link.to || pathname.startsWith(`${link.to}/`);
}

function StockTabLink({ to, label, icon: Icon, end }: StockLink) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "inline-flex items-center gap-2 rounded-t-lg border border-b-0 px-4 py-2.5 text-sm font-medium transition-colors",
          isActive
            ? "border-border bg-background text-foreground shadow-sm"
            : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </NavLink>
  );
}

export function ProdutosEstoqueLayout() {
  const location = useLocation();
  const navigate = useNavigate();

  const activeGroup =
    STOCK_GROUPS.find((group) =>
      group.links.some((link) => linkMatches(location.pathname, link)),
    ) ?? STOCK_GROUPS[0];

  return (
    <PageShell className="h-full space-y-6">
      <PageHeader
        icon={Package}
        title="Produtos e estoque"
        description="Visão geral, catálogo, movimentações, contagem, fichas técnicas e serviços."
      />

      <div className="flex h-full flex-col gap-6 md:flex-row md:items-start">
        <aside className="h-full w-full shrink-0 border-b border-border pb-4 md:w-56 md:border-b-0 md:border-r md:pb-0 md:pr-4">
          <nav
            className="flex h-full gap-2 md:flex-col md:gap-1"
            aria-label="Áreas de produtos e estoque"
          >
            {STOCK_GROUPS.map((group) => {
              const Icon = group.icon;
              const isActive = group.id === activeGroup?.id;
              const first = group.links[0];
              return (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => {
                    if (!isActive && first) navigate(first.to);
                  }}
                  className={cn(
                    "flex min-w-0 flex-1 items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors md:flex-none",
                    isActive
                      ? "border-border bg-background text-foreground shadow-sm"
                      : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {group.label}
                    </span>
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0 flex-1 space-y-6">
          {activeGroup && activeGroup.links.length > 1 ? (
            <nav
              className="flex flex-wrap gap-2 border-b border-border pb-px"
              aria-label={`Abas de ${activeGroup.label}`}
            >
              {activeGroup.links.map((link) => (
                <StockTabLink key={link.to} {...link} />
              ))}
            </nav>
          ) : null}

          <Outlet />
        </div>
      </div>
    </PageShell>
  );
}
