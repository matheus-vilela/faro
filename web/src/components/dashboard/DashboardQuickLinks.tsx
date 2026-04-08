import { canGestorAccess, type UserCompanyRole } from "@/lib/roles";
import { cn } from "@/lib/utils";
import {
  FileText,
  ListChecks,
  Package,
  PackageCheck,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router-dom";

type QuickItem = {
  to: string;
  label: string;
  description: string;
  icon: LucideIcon;
  gestorOnly?: boolean;
};

const ITEMS: QuickItem[] = [
  {
    to: "/app/fluxo-de-caixa",
    label: "Fluxo de caixa",
    description: "Boletos e vencimentos",
    icon: FileText,
  },
  {
    to: "/app/checklists",
    label: "Checklists",
    description: "Rotinas da operação",
    icon: ListChecks,
  },
  {
    to: "/app/recebimento",
    label: "Recebimento de mercadorias",
    description: "Mercadorias e NF",
    icon: PackageCheck,
  },
  {
    to: "/app/produtos",
    label: "Estoque",
    description: "Produtos e saldos",
    icon: Package,
  },
];

export function DashboardQuickLinks({
  role,
}: {
  role: UserCompanyRole | null;
}) {
  const visible = ITEMS.filter((item) => {
    if (!item.gestorOnly) return true;
    return role ? canGestorAccess(role) : false;
  });

  return (
    <div className="@container min-w-0">
      <div className="flex h-full flex-col rounded-2xl border border-border/80 bg-card/50 p-4 shadow-sm ring-1 ring-border/40">
      <div className="mb-4 flex flex-col gap-0.5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-semibold tracking-tight">
            Acesso rápido
          </h2>
          <p className="text-sm text-muted-foreground">
            Atalhos para a operação e o financeiro
          </p>
        </div>
      </div>
      <ul
        className={cn(
          "grid gap-2",
          /* Coluna estreita (ex.: metade do dashboard): 2×2; só em faixa larga vira 1×4 */
          "grid-cols-2 @[520px]:grid-cols-4",
        )}
      >
        {visible.map((item) => (
          <li key={item.to}>
            <Link
              to={item.to}
              className={cn(
                "group flex h-full flex-col gap-2 rounded-xl border border-border/70 bg-background/80 p-3 shadow-sm transition-all",
                "hover:border-primary/45 hover:bg-muted/50 hover:shadow-md",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <span
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg bg-primary/12 text-primary transition-colors",
                  "group-hover:bg-primary/18",
                )}
              >
                <item.icon className="h-[18px] w-[18px]" strokeWidth={2} />
              </span>
              <span className="text-sm font-semibold leading-tight text-foreground">
                {item.label}
              </span>
              <span className="text-[11px] leading-snug text-muted-foreground">
                {item.description}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      </div>
    </div>
  );
}
