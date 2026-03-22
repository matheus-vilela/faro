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
import { cn } from "@/lib/utils";
import { ROLE_LABELS } from "@/lib/roles";
import {
  BarChart3,
  Bell,
  Building2,
  LayoutDashboard,
  LogOut,
  Monitor,
  Moon,
  Package,
  PackageCheck,
  Receipt,
  Sun,
  Wallet,
  FileText,
  Truck,
} from "lucide-react";
import { Link, Navigate, Outlet } from "react-router-dom";

const NAV_ITEMS = [
  { title: "Dashboard", url: "/app", icon: LayoutDashboard, roles: ["operador", "gestor", "owner"] },
  { title: "Despesas", url: "/app/despesas", icon: Wallet, roles: ["operador", "gestor", "owner"] },
  { title: "Boletos", url: "/app/boletos", icon: FileText, roles: ["operador", "gestor", "owner"] },
  { title: "Fornecedores", url: "/app/fornecedores", icon: Truck, roles: ["operador", "gestor", "owner"] },
  { title: "Produtos", url: "/app/produtos", icon: Package, roles: ["operador", "gestor", "owner"] },
  { title: "Recebimento", url: "/app/recebimento", icon: PackageCheck, roles: ["operador", "gestor", "owner"] },
  { title: "Alertas", url: "/app/alertas", icon: Bell, roles: ["gestor", "owner"] },
  { title: "Relatórios", url: "/app/relatorios", icon: BarChart3, roles: ["gestor", "owner"] },
  { title: "Documentos", url: "/app/documentos", icon: Receipt, roles: ["operador", "gestor", "owner"] },
];

export function AppLayout() {
  const { currentCompany, loading } = useCompany();

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/95 backdrop-blur-sm">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-sm font-medium text-muted-foreground">Carregando...</p>
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

  const navItems = (currentRole
    ? NAV_ITEMS.filter((item) => item.roles.includes(currentRole))
    : NAV_ITEMS);
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  const initials = user?.email?.split("@")[0].slice(0, 2).toUpperCase() ?? "U";

  return (
    <>
      <Sidebar collapsible="icon">
        <SidebarHeader className="border-b px-4 py-3 flex h-16 items-center">
          <Link
            to="/app"
            className="flex items-center justify-center gap-2 font-semibold overflow-hidden w-full min-w-0 group-data-[collapsible=icon]:justify-center"
          >
            <span className="text-lg shrink-0 group-data-[collapsible=icon]:hidden">
              Faro
            </span>
            <span className="text-lg hidden group-data-[collapsible=icon]:inline">
              F
            </span>
          </Link>
          {/* {currentCompany && (
            <p className="text-xs text-muted-foreground mt-1 truncate">
              {currentCompany.name}
            </p>
          )} */}
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            {/* <SidebarGroupLabel>Menu</SidebarGroupLabel> */}
            {!isCollapsed && (
              <SidebarGroupLabel className="whitespace-nowrap">
                {" "}
              </SidebarGroupLabel>
            )}
            {isCollapsed && (
              <span
                className={cn(
                  "flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-sidebar-foreground/70 outline-none ring-sidebar-ring transition-[margin,opacity] duration-200 ease-linear focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
                )}
              >
                {" "}
              </span>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {navItems.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild tooltip={item.title}>
                      <Link to={item.url}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-16 items-center gap-4 border-b px-6">
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
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </SidebarInset>
    </>
  );
}
