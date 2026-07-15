import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  getWhatsappAgentDisplayLabel,
  getWhatsappAgentWaMeHref,
} from "@/lib/whatsappAgentDisplay";
import { ExternalLink, MessageCircle, Users } from "lucide-react";
import { Link } from "react-router-dom";

const cardWa = cn(
  "border-[#25D366]/25 shadow-sm shadow-[#25D366]/[0.08]",
  "dark:border-emerald-500/35 dark:shadow-emerald-900/20",
);

const linkWa = cn(
  "font-medium text-[#128C7E] underline-offset-4 hover:text-[#075E54] hover:underline",
  "dark:text-emerald-400 dark:hover:text-emerald-300",
);

const cmdPill = cn(
  "rounded-md bg-[#DCF8C6] px-1.5 py-0.5 font-mono text-sm font-medium text-[#075E54]",
  "dark:bg-emerald-950/80 dark:text-emerald-200",
);

export function ConfiguracoesWhatsapp() {
  const agentLabel = getWhatsappAgentDisplayLabel();
  const waMeHref = getWhatsappAgentWaMeHref();

  return (
    <PageShell>
      <div
        className={cn(
          "space-y-6 rounded-2xl border-2 border-[#25D366]/30 bg-linear-to-br p-4 sm:p-6 sm:space-y-8",
          "from-[#25D366]/14 via-background to-[#128C7E]/8",
          "dark:border-emerald-500/40 dark:from-emerald-500/15 dark:via-background dark:to-emerald-950/25",
        )}
      >
        <PageHeader
          icon={MessageCircle}
          iconClassName="text-[#25D366] drop-shadow-[0_0_10px_rgba(37,211,102,0.45)] dark:text-[#34eb7b]"
          className="rounded-xl border border-[#25D366]/25 bg-[#25D366]/8 p-4 dark:border-emerald-500/30 dark:bg-emerald-500/10"
          title={
            <span className="bg-linear-to-r from-[#075E54] to-[#128C7E] bg-clip-text text-transparent dark:from-emerald-200 dark:to-[#25D366]">
              WhatsApp
            </span>
          }
          description="Como funciona o agente Faro no WhatsApp, qual número usar e quais comandos e ações estão disponíveis."
        />

        <Card className={cn("overflow-hidden", cardWa)}>
          <div
            className="h-1 bg-linear-to-r from-[#25D366] via-[#128C7E] to-[#25D366]"
            aria-hidden
          />
          <CardHeader>
            <CardTitle className="text-[#075E54] dark:text-emerald-200">
              O que é o agente
            </CardTitle>
            <CardDescription>
              O Faro responde no WhatsApp por um{" "}
              <strong>único número de agente</strong> conectado à plataforma.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
            <p>
              O sistema descobre <strong>qual empresa você representa</strong>{" "}
              pelo <strong>número de WhatsApp</strong> cadastrado: o do{" "}
              <strong>proprietário</strong> ou de{" "}
              <strong>operadores ativos</strong> em{" "}
              <Link to="/app/configuracoes/usuarios" className={linkWa}>
                Configurações → Usuários e acessos
              </Link>
              . Por isso o celular precisa ser o mesmo que envia as mensagens.
            </p>
            <p>
              Mensagens de números não cadastrados não são associadas à sua
              empresa.
            </p>
          </CardContent>
        </Card>

        <Card className={cn("overflow-hidden", cardWa)}>
          <div
            className="h-1 bg-linear-to-r from-[#128C7E] via-[#25D366] to-[#128C7E]"
            aria-hidden
          />
          <CardHeader>
            <CardTitle className="text-[#075E54] dark:text-emerald-200">
              Número do agente
            </CardTitle>
            <CardDescription>
              Salve o contato oficial do Faro no WhatsApp e use essa conversa
              para os fluxos abaixo.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              className={cn(
                "relative overflow-hidden rounded-2xl border-2 border-[#25D366] bg-linear-to-br px-5 py-6 shadow-lg shadow-[#25D366]/20",
                "from-[#25D366]/25 via-[#DCF8C6]/90 to-[#128C7E]/15",
                "ring-2 ring-[#25D366]/30 ring-offset-2 ring-offset-background",
                "dark:border-emerald-400 dark:from-emerald-500/25 dark:via-emerald-950/70 dark:to-emerald-900/40 dark:ring-emerald-500/40",
              )}
            >
              <div
                className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-[#25D366]/25 blur-2xl dark:bg-emerald-400/20"
                aria-hidden
              />
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-[#128C7E] dark:text-emerald-300">
                Contato oficial do agente
              </p>
              <p
                className={cn(
                  "relative font-mono text-2xl font-bold tracking-tight text-[#075E54] sm:text-3xl md:text-4xl",
                  "drop-shadow-sm dark:text-emerald-50",
                )}
              >
                {agentLabel}
              </p>
              <a
                href={waMeHref}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "mt-4 inline-flex items-center gap-2 rounded-xl bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-white shadow-md transition-colors",
                  "hover:bg-[#20bd5a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366] focus-visible:ring-offset-2",
                  "dark:bg-emerald-500 dark:hover:bg-emerald-400",
                )}
              >
                Abrir conversa no WhatsApp
                <ExternalLink className="h-4 w-4 opacity-90" aria-hidden />
              </a>
            </div>
            {/* <p className="text-xs leading-relaxed text-muted-foreground">
              Em instalações customizadas o texto acima pode vir da variável{" "}
              <code
                className={cn("rounded-md px-1 py-0.5 text-[11px]", cmdPill)}
              >
                VITE_FARO_WHATSAPP_AGENT_DISPLAY
              </code>
              .
            </p> */}
          </CardContent>
        </Card>

        <Card className={cn("overflow-hidden", cardWa)}>
          <div
            className="h-1 bg-linear-to-r from-[#25D366] via-[#128C7E] to-[#25D366]"
            aria-hidden
          />
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-[#075E54] dark:text-emerald-200">
              Comandos de texto
              <Badge
                className={cn(
                  "border-0 bg-[#25D366] font-normal text-white shadow-sm hover:bg-[#20bd5a]",
                  "dark:bg-emerald-500 dark:hover:bg-emerald-400",
                )}
              >
                envie a palavra-chave na conversa
              </Badge>
            </CardTitle>
            <CardDescription>
              Envie uma mensagem contendo <strong>só o comando</strong> (uma
              palavra ou a frase indicada). O WhatsApp pode exibir negrito com
              asteriscos; o importante é o texto bater com o comando.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3 text-sm leading-relaxed text-muted-foreground">
              <li>
                <span className={cmdPill}>lista</span> — lista recebimentos
                pendentes de confirmação e abre um menu numérico para escolher
                um item.
              </li>
              <li>
                <span className={cmdPill}>comandos</span> — mostra a lista de
                comandos disponíveis para o seu perfil.
              </li>
              <li>
                <span className={cmdPill}>estoque</span> ou{" "}
                <span className={cmdPill}>inventario</span> — recebe um link
                para contagem de estoque. Operadores precisam da permissão em{" "}
                <Link
                  to="/app/configuracoes/usuarios"
                  className={linkWa}
                >
                  Usuários e acessos
                </Link>
                .
              </li>
              <li>
                <span className={cmdPill}>checklist</span> — se houver
                checklists atribuídos ao seu número, lista e permite abrir o
                fluxo (incluindo opções numéricas).
              </li>
              <li className="flex flex-wrap items-baseline gap-2">
                <span className={cmdPill}>contas a pagar</span>
                <Badge
                  variant="outline"
                  className="border-[#25D366]/50 text-[10px] uppercase text-[#128C7E] dark:border-emerald-500/60 dark:text-emerald-300"
                >
                  proprietário
                </Badge>
                <span>
                  — boletos com vencimento nos próximos 7 dias (visão do dono da
                  empresa).
                </span>
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card className={cn("overflow-hidden", cardWa)}>
          <div
            className="h-1 bg-linear-to-r from-[#25D366] to-[#128C7E]"
            aria-hidden
          />
          <CardHeader>
            <CardTitle className="text-[#075E54] dark:text-emerald-200">
              Notas fiscais por mídia ou texto
            </CardTitle>
            <CardDescription>
              Registro assistido por IA quando o recurso estiver ativo no
              servidor.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
            <p>
              O <strong>proprietário</strong> pode enviar <strong>foto</strong>{" "}
              de nota, cupom ou recibo, <strong>PDF</strong> ou um{" "}
              <strong>texto</strong> com os dados da compra. O fluxo pode pedir
              confirmações e gerar um link para revisão antes de lançar a
              despesa — conforme regras da empresa e do servidor.
            </p>
            <p>
              Despesas originadas no WhatsApp podem ficar{" "}
              <strong>aguardando aprovação do proprietário</strong> antes de
              integrar recebimento e estoque; acompanhe em{" "}
              <Link to="/app/despesas" className={linkWa}>
                Notas Fiscais
              </Link>{" "}
              e no painel de alertas.
            </p>
          </CardContent>
        </Card>

        <Card
          className={cn(
            "border-2 border-dashed border-[#25D366]/45 bg-[#25D366]/4 dark:border-emerald-500/50 dark:bg-emerald-950/20",
          )}
        >
          <CardHeader className="flex flex-row items-start gap-3 space-y-0">
            <Users className="h-5 w-5 shrink-0 text-[#25D366] dark:text-emerald-400" />
            <div className="space-y-1">
              <CardTitle className="text-base text-[#075E54] dark:text-emerald-200">
                Cadastro de números
              </CardTitle>
              <CardDescription>
                Garanta que o WhatsApp do proprietário e dos operadores esteja
                correto para o agente reconhecer a empresa e as permissões
                (checklist, estoque, etc.).
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <Link
              to="/app/configuracoes/usuarios"
              className={cn(
                "inline-flex rounded-lg bg-[#25D366] px-4 py-2 text-sm font-semibold text-white shadow-md transition-colors hover:bg-[#20bd5a]",
                "dark:bg-emerald-500 dark:hover:bg-emerald-400",
              )}
            >
              Abrir Usuários e acessos →
            </Link>
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
