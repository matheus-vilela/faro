import logoDark from "@/assets/logos/faro_logo_darkmode_transp.png";
import logoLight from "@/assets/logos/faro_logo_light_transparent.png";
import { CompanySelector } from "@/components/CompanySelector";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { useAuth } from "@/contexts/AuthContext";
import { useCompany } from "@/contexts/CompanyContext";
import { useTheme } from "@/contexts/ThemeContext";
import { ROLE_LABELS, type UserCompanyRole } from "@/lib/roles";
import { cn } from "@/lib/utils";
import {
  BarChart3,
  Bell,
  Building2,
  FlaskConical,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Moon,
  Package,
  PackageCheck,
  Plug,
  Settings2,
  Sun,
  TrendingDown,
  TrendingUp,
  Truck,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";

type NavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  roles: UserCompanyRole[];
  /** Só marca ativo na URL exata (evita sub-rotas, ex. /desenvolvimento vs /desenvolvimento/fornecedores). */
  exact?: boolean;
};

const NAV_SECTIONS: { label: string; adminOnly?: boolean; items: NavItem[] }[] = [
  {
    label: "Principal",
    items: [
      {
        title: "Dashboard",
        url: "/app",
        icon: LayoutDashboard,
        roles: ["operador", "gestor", "owner"],
      },
    ],
  },
  {
    label: "Operação",
    items: [
      {
        title: "Despesas",
        url: "/app/despesas",
        icon: Wallet,
        roles: ["operador", "gestor", "owner"],
      },

      {
        title: "Recebimento de mercadorias",
        url: "/app/recebimento",
        icon: PackageCheck,
        roles: ["operador", "gestor", "owner"],
      },
      {
        title: "Checklists",
        url: "/app/checklists",
        icon: ListChecks,
        roles: ["operador", "gestor", "owner"],
      },
      {
        title: "Fornecedores",
        url: "/app/fornecedores",
        icon: Truck,
        roles: ["operador", "gestor", "owner"],
      },
      {
        title: "Produtos e estoque",
        url: "/app/produtos",
        icon: Package,
        roles: ["operador", "gestor", "owner"],
      },
    ],
  },
  {
    label: "Financeiro",
    items: [
      {
        title: "Contas a pagar",
        url: "/app/contas-a-pagar",
        icon: TrendingDown,
        roles: ["operador", "gestor", "owner"],
      },
      {
        title: "Vendas realizadas",
        url: "/app/vendas-realizadas",
        icon: TrendingUp,
        roles: ["operador", "gestor", "owner"],
      },
      {
        title: "DRE",
        url: "/app/dre",
        icon: BarChart3,
        roles: ["gestor", "owner"],
      },
    ],
  },
  {
    label: "Gestão",
    items: [
      {
        title: "Alertas",
        url: "/app/alertas",
        icon: Bell,
        roles: ["gestor", "owner"],
      },
      {
        title: "Integrações",
        url: "/app/integracoes",
        icon: Plug,
        roles: ["gestor", "owner"],
      },
    ],
  },
  {
    label: "Desenvolvimento",
    adminOnly: true,
    items: [
      {
        title: "Ferramentas",
        url: "/app/desenvolvimento",
        icon: FlaskConical,
        roles: ["operador", "gestor", "owner"],
        exact: true,
      },
      {
        title: "Fornecedores globais",
        url: "/app/desenvolvimento/fornecedores",
        icon: Truck,
        roles: ["operador", "gestor", "owner"],
      },
    ],
  },
  {
    label: "Sistema",
    items: [
      {
        title: "Configurações",
        url: "/app/configuracoes",
        icon: Settings2,
        roles: ["owner"],
      },
    ],
  },
];

function isNavActive(pathname: string, url: string, exact?: boolean): boolean {
  if (url === "/app") {
    return pathname === "/app" || pathname === "/app/";
  }
  if (exact) {
    return pathname === url || pathname === `${url}/`;
  }
  return pathname === url || pathname.startsWith(`${url}/`);
}

export function AppLayout() {
  const { currentCompany, loading } = useCompany();

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/95 backdrop-blur-sm">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-sm font-medium text-muted-foreground">
          Carregando...
        </p>
      </div>
    );
  }

  if (!currentCompany) {
    return <Navigate to="/empresas" replace />;
  }

  return (
    <SidebarProvider>
      <AppLayoutContent />
    </SidebarProvider>
  );
}

function AppLayoutContent() {
  const { user, signOut, isAdmin } = useAuth();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { currentCompany, currentRole } = useCompany();
  const location = useLocation();
  const { isMobile } = useSidebar();

  const navSections = currentRole
    ? NAV_SECTIONS.filter((section) => !section.adminOnly || isAdmin)
        .map((section) => ({
          label: section.label,
          items: section.items.filter((item) =>
            item.roles.includes(currentRole),
          ),
        }))
        .filter((section) => section.items.length > 0)
    : NAV_SECTIONS.filter((section) => !section.adminOnly || isAdmin).map(
        (s) => ({ ...s, items: [...s.items] }),
      );
  const initials = user?.email?.split("@")[0].slice(0, 2).toUpperCase() ?? "U";

  return (
    <div className="relative flex  w-full">
      <header
        className={cn(
          "fixed top-[var(--faro-dev-banner-height,0px)] z-50 flex w-full h-12 shrink-0 items-center gap-1 sm:gap-2 px-2 border-b border-border bg-card backdrop-blur supports-backdrop-filter:bg-card",
        )}
      >
        {isMobile && (
          <SidebarTrigger
            className={`flex items-center justify-center gap-2.5 w-8 `}
          />
        )}

        <Link
          to="/app"
          aria-label="Faro — início"
          className="flex min-w-0  items-center justify-center gap-2.5 overflow-hidden font-semibold tracking-tight group-data-[collapsible=icon]:justify-center  rounded-md pr-6"
        >
          {resolvedTheme === "dark" ? (
            <img
              src={logoDark}
              alt=""
              width={128}
              height={64}
              aria-hidden
              className="h-12 w-16 sm:w-20 shrink-0 object-contain"
            />
          ) : (
            <img
              src={logoLight}
              alt=""
              width={128}
              height={64}
              aria-hidden
              className="h-12 w-16 sm:w-20 shrink-0 object-contain"
            />
          )}
        </Link>
        <CompanySelector />
        <div className="flex-1" />
        <div className="flex items-center gap-1 sm:gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                {resolvedTheme === "dark" ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setTheme("light")}>
                <Sun
                  className={`mr-2 h-4 w-4 ${theme === "light" ? "opacity-100" : "opacity-50"}`}
                />
                Claro
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("dark")}>
                <Moon
                  className={`mr-2 h-4 w-4 ${theme === "dark" ? "opacity-100" : "opacity-50"}`}
                />
                Escuro
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-9 w-9 rounded-full">
                <Avatar className="h-9 w-9">
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <div className="flex items-center justify-start gap-2 p-2">
                <Avatar className="h-8 w-8">
                  <AvatarFallback>{initials}</AvatarFallback>
                </Avatar>
                <div className="flex flex-col space-y-1 leading-none">
                  <p className="font-medium">{user?.email}</p>
                  {currentCompany && (
                    <div className="flex flex-col gap-0.5">
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Building2 className="h-3 w-3" />
                        {currentCompany.name}
                      </p>
                      {currentRole && (
                        <p className="text-xs text-muted-foreground/80">
                          {ROLE_LABELS[currentRole]}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => signOut()}
                className="text-destructive"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <Sidebar
        collapsible="icon"
        className="top-[calc(3rem+var(--faro-dev-banner-height,0px))] bottom-0 h-auto min-h-0"
      >
        {isMobile && (
          <SidebarHeader className="flex items-start justify-center ">
            <Link
              to="/app"
              aria-label="Faro — início"
              className="flex min-w-0  items-center justify-center gap-2.5 overflow-hidden font-semibold tracking-tight group-data-[collapsible=icon]:justify-center  rounded-md pr-6"
            >
              {resolvedTheme === "dark" ? (
                <img
                  src={logoDark}
                  alt=""
                  width={128}
                  height={64}
                  aria-hidden
                  className="h-12 w-20 shrink-0 object-contain"
                />
              ) : (
                <img
                  src={logoLight}
                  alt=""
                  width={128}
                  height={64}
                  aria-hidden
                  className="h-12 w-20 shrink-0 object-contain"
                />
              )}
            </Link>
          </SidebarHeader>
        )}
        <SidebarContent>
          {navSections.map((section) => (
            <SidebarGroup key={section.label}>
              <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
              <SidebarGroupContent className="mt-0">
                <SidebarMenu>
                  {section.items.map((item) => {
                    const active = isNavActive(
                      location.pathname,
                      item.url,
                      item.exact,
                    );
                    return (
                      <SidebarMenuItem key={item.url}>
                        <SidebarMenuButton
                          asChild
                          isActive={active}
                          tooltip={item.title}
                          className={cn(
                            "transition-colors",
                            active &&
                              "bg-primary/15 text-primary shadow-sm hover:bg-primary/20 hover:text-primary data-[active=true]:bg-primary/15 data-[active=true]:text-primary",
                          )}
                        >
                          <Link to={item.url}>
                            <item.icon
                              className={cn(
                                "h-4 w-4 shrink-0",
                                active && "text-primary",
                              )}
                            />
                            <span>{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
      </Sidebar>
      <SidebarInset className="mt-[calc(3rem+var(--faro-dev-banner-height,0px))] ">
        <main className="flex-1 py-4 px-4 sm:px-8 w-full">
          <Outlet />
        </main>
      </SidebarInset>
    </div>
  );
}
