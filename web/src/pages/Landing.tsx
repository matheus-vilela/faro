import logoDark from "@/assets/logos/faro_logo_darkmode_transp.png";
import logoLight from "@/assets/logos/faro_logo_light_transparent.png";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";
import {
  getWhatsappAgentDisplayLabel,
  getWhatsappAgentWaMeHref,
} from "@/lib/whatsappAgentDisplay";
import {
  ArrowRight,
  BarChart3,
  Bell,
  Check,
  FileText,
  MessageCircle,
  Package,
  Shield,
  Sparkles,
  Warehouse,
} from "lucide-react";
import { Link } from "react-router-dom";

const whatsappHighlights = [
  "Operadores podem confirmar recebimento com checklist pelo WhatsApp — ideal para balcão e estoque, sem depender do computador na correria.",
  "Gestores podem validar contas a pagar da semana e acompanhar pendências pelo mesmo fluxo integrado ao Faro.",
  "Alertas e lembretes chegam na conversa: o que precisa de atenção fica visível para quem decide, no próprio WhatsApp.",
  // "Membros da equipe usam o celular com o número cadastrado; o proprietário valida a empresa nas mensagens recebidas.",
];

const featureCards = [
  {
    icon: FileText,
    title: "Contas e despesas",
    text: "Boletos, despesas e fornecedores no mesmo fluxo, com período de referência claro.",
  },
  {
    icon: Warehouse,
    title: "Estoque e produtos",
    text: "Base de produtos com importação em planilha e alertas de estoque baixo.",
  },
  {
    icon: Package,
    title: "Recebimento",
    text: "Acompanhe entregas e compartilhe links para confirmação com a equipe.",
  },
  {
    icon: Bell,
    title: "Alertas",
    text: "Visão rápida do que precisa de atenção: recebimentos, boletos e margem.",
  },
  {
    icon: BarChart3,
    title: "Painel operacional",
    text: "Dashboard com o essencial para gestores e proprietários.",
  },
  {
    icon: Shield,
    title: "Dados da empresa",
    text: "Multi-empresa, papéis por perfil e configurações centralizadas.",
  },
];

export function Landing() {
  const { resolvedTheme } = useTheme();

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-background text-foreground">
      {/* Camadas de fundo */}
      <div className="pointer-events-none fixed inset-0 -z-10" aria-hidden>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,oklch(0.646_0.222_41.116/0.18),transparent_55%)] dark:bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,oklch(0.705_0.213_47.604/0.22),transparent_55%)]" />
        <div className="landing-mesh-breathe absolute inset-0 bg-[radial-gradient(ellipse_90%_60%_at_100%_50%,oklch(0.705_0.213_47.604/0.12),transparent_50%)] dark:bg-[radial-gradient(ellipse_90%_60%_at_100%_50%,oklch(0.837_0.128_66.29/0.15),transparent_50%)]" />
        <div className="landing-blob absolute -left-[20%] top-[10%] h-[min(90vw,520px)] w-[min(90vw,520px)] rounded-full bg-primary/15 blur-[100px] dark:bg-primary/25" />
        <div className="landing-blob-2 absolute -right-[15%] top-[35%] h-[min(80vw,440px)] w-[min(80vw,440px)] rounded-full bg-chart-2/20 blur-[90px] dark:bg-chart-2/25" />
        <div className="landing-blob-3 absolute bottom-[5%] left-[30%] h-[min(70vw,360px)] w-[min(70vw,360px)] rounded-full bg-primary/10 blur-[80px]" />
        <div className="landing-noise absolute inset-0 opacity-[0.4] mix-blend-overlay dark:opacity-[0.22]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-linear-to-t from-background to-transparent" />
      </div>

      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/75 backdrop-blur-xl transition-[background,box-shadow] duration-500 supports-[backdrop-filter]:bg-background/65 dark:border-white/10 sticky">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link
            to="/"
            className="flex items-center transition-opacity hover:opacity-90"
            aria-label="Faro — início"
          >
            <img
              src={resolvedTheme === "dark" ? logoDark : logoLight}
              alt=""
              width={140}
              height={50}
              className="h-12 w-auto max-w-[min(140px,42vw)] object-contain object-left sm:h-16"
              decoding="async"
            />
          </Link>
          <nav className="flex items-center gap-2 sm:gap-3">
            <Link to="/login">
              <Button
                variant="ghost"
                className="transition-transform duration-300 hover:scale-[1.02]"
              >
                Entrar
              </Button>
            </Link>
            <Link to="/register">
              <Button className="shadow-md shadow-primary/20 transition-all duration-300 hover:scale-[1.02] hover:shadow-lg hover:shadow-primary/25">
                Cadastrar
              </Button>
            </Link>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative px-4 pb-20 pt-16 sm:px-6 sm:pb-28 sm:pt-20 md:pt-24">
          <div className="mx-auto max-w-4xl text-center">
            <div className="landing-fade-up landing-fade-up-delay-1 mb-6 flex flex-col items-center gap-3 sm:flex-row sm:flex-wrap sm:justify-center">
              <p
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border border-[#25D366]/35 bg-[#25D366]/12 px-4 py-1.5 text-sm font-semibold tracking-[0.02em] text-[#128C7E] dark:border-[#25D366]/45 dark:bg-[#25D366]/15 dark:text-[#25F4EE]",
                )}
              >
                <MessageCircle className="h-4 w-4 shrink-0" aria-hidden />
                Integração WhatsApp
              </p>
              <p
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-4 py-1.5 text-sm font-semibold tracking-[0.02em] text-primary dark:bg-primary/15",
                )}
              >
                <Sparkles className="h-4 w-4 shrink-0" />
                Gestão operacional para food service
              </p>
            </div>
            <h1
              className={cn(
                "landing-fade-up landing-fade-up-delay-2 font-display font-bold tracking-[-0.02em] text-foreground",
                "text-[clamp(2.25rem,6vw,3.75rem)] leading-[1.08]",
              )}
            >
              Controle fiscal e operação{" "}
              <span className="relative inline-block">
                <span className="relative z-10 bg-linear-to-r from-primary via-chart-2 to-primary bg-clip-text text-transparent dark:from-primary dark:via-chart-1 dark:to-primary">
                  em um só lugar
                </span>
                <span
                  className="absolute -inset-1 -z-0 rounded-lg bg-primary/10 blur-xl dark:bg-primary/20"
                  aria-hidden
                />
              </span>
            </h1>
            <p
              className={cn(
                "landing-fade-up landing-fade-up-delay-3 mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground sm:text-xl",
              )}
            >
              Despesas, contas a pagar, fornecedores, estoque e recebimento —
              com{" "}
              <strong className="font-semibold text-foreground">
                WhatsApp
              </strong>{" "}
              no fluxo: membros e mensagens ligados à sua empresa. Pensado para
              bares e restaurantes.
            </p>
            <div
              className={cn(
                "landing-fade-up landing-fade-up-delay-4 mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row",
              )}
            >
              <Link to="/register" className="group w-full sm:w-auto">
                <Button
                  size="lg"
                  className="h-12 w-full px-8 text-base font-semibold tracking-[0.02em] shadow-lg shadow-primary/25 transition-all duration-300 hover:scale-[1.03] hover:shadow-xl hover:shadow-primary/30 sm:w-auto"
                >
                  Começar grátis
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" />
                </Button>
              </Link>
              <Link to="/login" className="w-full sm:w-auto">
                <Button
                  size="lg"
                  variant="outline"
                  className="h-12 w-full border-border/80 bg-background/50 backdrop-blur-sm transition-all duration-300 hover:scale-[1.02] hover:bg-muted/80 sm:w-auto"
                >
                  Já tenho conta
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* Destaque WhatsApp */}
        <section className="relative px-4 pb-16 pt-2 sm:px-6 sm:pb-20">
          <div className="relative mx-auto max-w-5xl overflow-hidden rounded-3xl border border-[#25D366]/30 bg-linear-to-br from-[#25D366]/12 via-background to-background p-8 shadow-lg shadow-[#25D366]/10 dark:border-[#25D366]/25 dark:from-[#25D366]/18 dark:via-background dark:to-background dark:shadow-[#25D366]/15 sm:p-10 md:p-12">
            <div
              className="landing-noise pointer-events-none absolute inset-0 opacity-[0.12] mix-blend-overlay dark:opacity-[0.18]"
              aria-hidden
            />
            <div className="pointer-events-none absolute -right-16 top-1/2 h-64 w-64 -translate-y-1/2 rounded-full bg-[#25D366]/20 blur-3xl dark:bg-[#25D366]/25" />
            <div className="relative grid gap-10 md:grid-cols-[1fr_1.1fr] md:items-center md:gap-12">
              <div>
                <p className="inline-flex items-center gap-2 rounded-full border border-[#25D366]/40 bg-[#25D366]/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-[#075E54] dark:border-[#25D366]/50 dark:bg-[#25D366]/20 dark:text-[#25F4EE]">
                  <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                  Canal oficial
                </p>
                <h2 className="mt-4 font-display text-2xl font-bold tracking-[-0.02em] text-foreground sm:text-3xl md:text-4xl">
                  WhatsApp no centro da{" "}
                  <span className="bg-linear-to-r from-[#128C7E] to-[#25D366] bg-clip-text text-transparent dark:from-[#25F4EE] dark:to-[#25D366]">
                    operação
                  </span>
                </h2>
                <p className="mt-3 text-base leading-relaxed text-muted-foreground sm:text-lg">
                  Você define quem da equipe pode interagir pelo WhatsApp — tudo
                  centralizado nas configurações, sem complicar o dia a dia do
                  estabelecimento.
                </p>
              </div>
              <ul className="space-y-4">
                {whatsappHighlights.map((line) => (
                  <li
                    key={line}
                    className="flex gap-3 rounded-xl border border-border/60 bg-background/80 p-4 backdrop-blur-sm transition-colors duration-300 hover:border-[#25D366]/35 dark:border-white/10 dark:bg-background/50"
                  >
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#25D366]/20 text-[#075E54] dark:bg-[#25D366]/30 dark:text-[#25F4EE]">
                      <Check className="h-3.5 w-3.5" strokeWidth={3} />
                    </span>
                    <span className="text-sm leading-relaxed text-foreground sm:text-[0.9375rem]">
                      {line}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* Faixa de confiança */}
        <section className="border-y border-border/40 bg-muted/30 py-10 backdrop-blur-sm dark:bg-muted/20">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-10 gap-y-4 px-4 text-center text-sm font-medium text-muted-foreground sm:px-6">
            <span className="flex items-center gap-2 transition-colors duration-300 hover:text-foreground">
              <MessageCircle
                className="h-4 w-4 shrink-0 text-[#25D366]"
                aria-hidden
              />
              WhatsApp para equipe e validação
            </span>
            <span className="hidden h-4 w-px bg-border sm:block" aria-hidden />
            <span className="transition-colors duration-300 hover:text-foreground">
              Importação de produtos
            </span>
            <span className="hidden h-4 w-px bg-border sm:block" aria-hidden />
            <span className="transition-colors duration-300 hover:text-foreground">
              Período de referência unificado
            </span>
            <span className="hidden h-4 w-px bg-border sm:block" aria-hidden />
            <span className="transition-colors duration-300 hover:text-foreground">
              Alertas e recebimento
            </span>
          </div>
        </section>

        {/* Recursos */}
        <section className="px-4 py-20 sm:px-6 sm:py-28">
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto mb-14 max-w-2xl text-center">
              <h2 className="font-display text-3xl font-semibold tracking-[-0.01em] text-foreground sm:text-4xl">
                O que o Faro oferece
              </h2>
              <p className="mt-4 text-lg text-muted-foreground">
                Módulos pensados para o dia a dia do estabelecimento, com
                transições suaves e leitura clara.
              </p>
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {featureCards.map(({ icon: Icon, title, text }, i) => (
                <div
                  key={title}
                  className={cn(
                    "group relative overflow-hidden rounded-2xl border border-border/60 bg-card/40 p-6 shadow-sm backdrop-blur-md transition-all duration-500",
                    "hover:-translate-y-1 hover:border-primary/35 hover:bg-card/70 hover:shadow-lg hover:shadow-primary/5",
                    "dark:border-white/10 dark:bg-card/30 dark:hover:border-primary/40",
                  )}
                  style={{ transitionDelay: `${i * 40}ms` }}
                >
                  <div
                    className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
                    aria-hidden
                  >
                    <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-primary/10 blur-2xl dark:bg-primary/20" />
                  </div>
                  <div className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/20 transition-transform duration-500 group-hover:scale-105 dark:bg-primary/20">
                    <Icon className="h-6 w-6" />
                  </div>
                  <h3 className="relative mt-4 font-display text-lg font-semibold tracking-[-0.01em]">
                    {title}
                  </h3>
                  <p className="relative mt-2 text-sm leading-relaxed text-muted-foreground">
                    {text}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA final */}
        <section className="px-4 pb-24 pt-4 sm:px-6">
          <div className="relative mx-auto max-w-4xl overflow-hidden rounded-3xl border border-primary/25 bg-linear-to-br from-primary/15 via-primary/8 to-transparent p-10 text-center shadow-xl shadow-primary/10 dark:from-primary/25 dark:via-primary/12 dark:shadow-primary/20 sm:p-14">
            <div
              className="landing-noise pointer-events-none absolute inset-0 opacity-[0.15] mix-blend-overlay"
              aria-hidden
            />
            <h2 className="relative font-display text-2xl font-semibold tracking-[-0.01em] sm:text-3xl">
              Pronto para organizar sua operação?
            </h2>
            <p className="relative mx-auto mt-3 max-w-lg text-muted-foreground">
              Crie sua conta em minutos, defina o WhatsApp do proprietário e
              convide a equipe com papéis de operador, gestor ou proprietário.
            </p>
            <div className="relative mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link to="/register">
                <Button
                  size="lg"
                  className="h-12 px-8 font-semibold tracking-[0.02em] shadow-lg transition-all duration-300 hover:scale-[1.03]"
                >
                  Criar conta
                </Button>
              </Link>
              <Link to="/login">
                <Button
                  size="lg"
                  variant="ghost"
                  className="h-12 text-primary hover:bg-primary/10"
                >
                  Entrar na plataforma
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/50 bg-muted/20 backdrop-blur-sm dark:bg-muted/10">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <div className="grid gap-10 text-sm text-muted-foreground md:grid-cols-[1fr_auto] md:gap-12">
            <div className="space-y-3 text-left">
              <p className="font-display text-base font-semibold text-foreground">
                FARO IA LTDA
              </p>
              <p>
                <a
                  className="text-primary underline-offset-4 hover:underline"
                  href="mailto:contato@faroia.com.br"
                >
                  contato@faroia.com.br
                </a>
              </p>
              <p>CNPJ: 66.385.510/0001-32 (Matriz)</p>
              <p className="max-w-md leading-relaxed">
                R. Cavazzola, 72, Sala Superior — Vila Olímpia, São Paulo/SP —
                CEP 04546-060
              </p>
              <p>
                Telefone:{" "}
                <a
                  className="text-primary underline-offset-4 hover:underline"
                  href="tel:+5511917589292"
                >
                  (11) 91758-9292
                </a>
              </p>
              <p>
                <a
                  className="inline-flex items-center gap-2 font-medium text-[#128C7E] underline-offset-4 hover:underline dark:text-[#25F4EE]"
                  href={getWhatsappAgentWaMeHref()}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageCircle className="h-4 w-4 shrink-0" aria-hidden />
                  WhatsApp: {getWhatsappAgentDisplayLabel()}
                </a>
              </p>
            </div>
            <nav
              className="flex flex-col gap-3 text-left md:border-l md:border-border/60 md:pl-12"
              aria-label="Documentos legais"
            >
              <Link
                to="/privacidade"
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                Política de privacidade
              </Link>
              <Link
                to="/termos"
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                Termos de uso
              </Link>
            </nav>
          </div>
          <p className="mt-10 border-t border-border/50 pt-8 text-center text-sm text-muted-foreground">
            © {new Date().getFullYear()} Faro. Todos os direitos reservados.
          </p>
        </div>
      </footer>
    </div>
  );
}
