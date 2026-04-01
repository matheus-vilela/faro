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
import { ROLE_LABELS } from "@/lib/roles";
import { cn } from "@/lib/utils";
import {
  Bell,
  Building2,
  FileText,
  LayoutDashboard,
  LogOut,
  Monitor,
  Moon,
  Package,
  PackageCheck,
  Settings2,
  Sun,
  Truck,
  Wallet,
} from "lucide-react";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";

const NAV_ITEMS = [
  {
    title: "Dashboard",
    url: "/app",
    icon: LayoutDashboard,
    roles: ["operador", "gestor", "owner"],
  },
  {
    title: "Fluxo de Caixa",
    url: "/app/fluxo-de-caixa",
    icon: FileText,
    roles: ["operador", "gestor", "owner"],
  },
  {
    title: "Despesas",
    url: "/app/despesas",
    icon: Wallet,
    roles: ["operador", "gestor", "owner"],
  },
  {
    title: "Fornecedores",
    url: "/app/fornecedores",
    icon: Truck,
    roles: ["operador", "gestor", "owner"],
  },
  {
    title: "Produtos",
    url: "/app/produtos",
    icon: Package,
    roles: ["operador", "gestor", "owner"],
  },
  {
    title: "Recebimento",
    url: "/app/recebimento",
    icon: PackageCheck,
    roles: ["operador", "gestor", "owner"],
  },
  {
    title: "Alertas",
    url: "/app/alertas",
    icon: Bell,
    roles: ["gestor", "owner"],
  },
  {
    title: "Configurações",
    url: "/app/configuracoes",
    icon: Settings2,
    roles: ["owner"],
  },
];

function isNavActive(pathname: string, url: string): boolean {
  if (url === "/app") {
    return pathname === "/app" || pathname === "/app/";
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
  const { user, signOut } = useAuth();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { currentCompany, currentRole } = useCompany();
  const location = useLocation();
  const { state } = useSidebar();

  const navItems = currentRole
    ? NAV_ITEMS.filter((item) => item.roles.includes(currentRole))
    : NAV_ITEMS;
  const initials = user?.email?.split("@")[0].slice(0, 2).toUpperCase() ?? "U";

  return (
    <>
      <Sidebar collapsible="icon">
        <SidebarHeader className="flex h-16 items-center border-b px-2 py-4">
          <Link
            to="/app"
            aria-label="Faro — início"
            className="flex min-w-0 w-full items-center justify-center gap-2.5 overflow-hidden font-semibold tracking-tight group-data-[collapsible=icon]:justify-center  rounded-md"
          >
            {state === "collapsed" ? (
              <img
                src="/src/assets/logos/favicon.png"
                alt=""
                width={48}
                height={48}
                aria-hidden
                className="h-12 w-16 shrink-0 object-contain"
              />
            ) : resolvedTheme === "dark" ? (
              <img
                src="/src/assets/logos/faro_logo_darkmode_transp.png"
                alt=""
                width={128}
                height={64}
                aria-hidden
                className="h-12 w-28 shrink-0 object-contain"
              />
            ) : (
              <img
                src="/src/assets/logos/faro_logo_light_transparent.png"
                alt=""
                width={128}
                height={64}
                aria-hidden
                className="h-8 w-28 shrink-0 object-contain"
              />
            )}
          </Link>
          {/* {currentCompany && (
            <p className="text-xs text-muted-foreground mt-1 truncate">
              {currentCompany.name}
            </p>
          )} */}
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent className="mt-2">
              <SidebarMenu>
                {navItems.map((item) => {
                  const active = isNavActive(location.pathname, item.url);
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
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-16 items-center gap-4 border-b px-6 sticky top-0 bg-background z-10">
          <SidebarTrigger />
          <CompanySelector />
          <div className="flex-1" />
          <div className="flex items-center gap-2">
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
                <DropdownMenuItem onClick={() => setTheme("system")}>
                  <Monitor
                    className={`mr-2 h-4 w-4 ${theme === "system" ? "opacity-100" : "opacity-50"}`}
                  />
                  Sistema
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="relative h-9 w-9 rounded-full"
                >
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
        <main className="flex-1 py-4 px-4 sm:px-8">
          <Outlet />
        </main>
      </SidebarInset>
    </>
  );
}
