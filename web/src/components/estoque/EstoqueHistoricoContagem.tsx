import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { supabase } from "@/lib/supabase";
import { History, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type ShortLinkEmbed = { slug?: string | null } | { slug?: string | null }[] | null;

type SessionRow = {
  id: string;
  status: string;
  token: string;
  created_at: string;
  submitted_at: string | null;
  company_member_id: string | null;
  created_by_user_id: string | null;
  inventory_count_group_id: string | null;
  inventory_count_listing_id: string | null;
  assigned_company_member_id: string | null;
  inventory_count_groups: { name: string } | null;
  inventory_count_listings: { name: string } | null;
  initiator_member: { name: string } | null;
  assigned_member: { name: string } | null;
  profiles: { full_name: string | null } | null;
  inventory_count_short_links: ShortLinkEmbed;
};

function slugFromEmbed(raw: ShortLinkEmbed): string | null {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const s = raw[0]?.slug;
    return typeof s === "string" && s ? s : null;
  }
  const s = raw.slug;
  return typeof s === "string" && s ? s : null;
}

function buildSessionLink(r: SessionRow): string {
  const base =
    typeof window !== "undefined"
      ? window.location.origin.replace(/\/$/, "")
      : "";
  const slug = slugFromEmbed(r.inventory_count_short_links);
  if (slug) return `${base}/i/${slug}`;
  return `${base}/contagem-estoque/${r.token}`;
}

function initiatorLabel(r: SessionRow): string {
  const cm = r.initiator_member;
  if (cm?.name?.trim()) return cm.name.trim();
  const pf = r.profiles;
  if (pf?.full_name?.trim()) return pf.full_name.trim();
  return "Proprietário (WhatsApp)";
}

function formatDt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sortOpen(a: SessionRow, b: SessionRow): number {
  return (
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

function sortSubmitted(a: SessionRow, b: SessionRow): number {
  const ta = a.submitted_at ? new Date(a.submitted_at).getTime() : 0;
  const tb = b.submitted_at ? new Date(b.submitted_at).getTime() : 0;
  return tb - ta;
}

export function EstoqueHistoricoContagem({
  companyId,
  refreshTrigger = 0,
}: {
  companyId: string;
  /** Incrementar após nova contagem para recarregar a lista. */
  refreshTrigger?: number;
}) {
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("inventory_count_sessions")
      .select(
        `
        id,
        status,
        token,
        created_at,
        submitted_at,
        company_member_id,
        created_by_user_id,
        inventory_count_group_id,
        inventory_count_listing_id,
        assigned_company_member_id,
        inventory_count_groups ( name ),
        inventory_count_listings ( name ),
        initiator_member:company_members!inventory_count_sessions_company_member_id_fkey ( name ),
        assigned_member:company_members!inventory_count_sessions_assigned_company_member_id_fkey ( name ),
        profiles!inventory_count_sessions_created_by_user_id_fkey ( full_name ),
        inventory_count_short_links ( slug )
      `,
      )
      .eq("company_id", companyId)
      .in("status", ["open", "submitted"])
      .limit(120);

    setLoading(false);
    if (error) {
      console.error(error);
      setRows([]);
      return;
    }
    setRows((data ?? []) as unknown as SessionRow[]);
  }, [companyId]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load, refreshTrigger]);

  const { pending, concluded } = useMemo(() => {
    const raw = rows ?? [];
    const open = raw
      .filter((r) => r.status === "open")
      .sort(sortOpen);
    const sub = raw
      .filter((r) => r.status === "submitted")
      .sort(sortSubmitted);
    return { pending: open, concluded: sub };
  }, [rows]);

  const renderRow = (r: SessionRow, variant: "open" | "submitted") => {
    const origin = r.company_member_id
      ? "WhatsApp (operador)"
      : r.created_by_user_id
        ? "Painel"
        : "WhatsApp (proprietário)";
    const groupName = r.inventory_count_groups?.name?.trim() || "—";
    const listingName = r.inventory_count_listings?.name?.trim() || "—";
    const assigned = r.assigned_member?.name?.trim() || "—";
    const link = buildSessionLink(r);
    const dateLabel =
      variant === "open"
        ? formatDt(r.created_at)
        : formatDt(r.submitted_at);

    return (
      <tr key={r.id} className="border-b border-border/60">
        <td className="p-2 whitespace-nowrap text-muted-foreground">
          {dateLabel}
        </td>
        <td className="p-2">
          {variant === "open" ? (
            <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-200">
              Pendente
            </span>
          ) : (
            <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              Concluída
            </span>
          )}
        </td>
        <td className="p-2 text-muted-foreground">{groupName}</td>
        <td className="p-2 text-muted-foreground">{listingName}</td>
        <td className="p-2 text-muted-foreground">{assigned}</td>
        <td className="p-2 font-medium">{initiatorLabel(r)}</td>
        <td className="p-2 text-muted-foreground">{origin}</td>
        <td className="p-2 max-w-[min(200px,28vw)]">
          <a
            href={link}
            className="break-all text-xs text-primary underline-offset-2 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Abrir
          </a>
        </td>
      </tr>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4" />
          Histórico de contagens
        </CardTitle>
        <CardDescription>
          Pendentes (link gerado e ainda não enviado) e concluídas: grupo,
          listagem, operador designado, quem iniciou e datas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando…
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma contagem registrada ainda.
          </p>
        ) : (
          <>
            {pending.length > 0 ? (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-foreground">
                  Pendentes
                </h4>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                        <th className="p-2 font-medium">Gerada em</th>
                        <th className="p-2 font-medium">Situação</th>
                        <th className="p-2 font-medium">Grupo</th>
                        <th className="p-2 font-medium">Listagem</th>
                        <th className="p-2 font-medium">Operador</th>
                        <th className="p-2 font-medium">Iniciada por</th>
                        <th className="p-2 font-medium">Origem</th>
                        <th className="p-2 font-medium">Link</th>
                      </tr>
                    </thead>
                    <tbody>{pending.map((r) => renderRow(r, "open"))}</tbody>
                  </table>
                </div>
              </div>
            ) : null}

            {concluded.length > 0 ? (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-foreground">
                  Concluídas
                </h4>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                        <th className="p-2 font-medium">Enviada em</th>
                        <th className="p-2 font-medium">Situação</th>
                        <th className="p-2 font-medium">Grupo</th>
                        <th className="p-2 font-medium">Listagem</th>
                        <th className="p-2 font-medium">Operador</th>
                        <th className="p-2 font-medium">Iniciada por</th>
                        <th className="p-2 font-medium">Origem</th>
                        <th className="p-2 font-medium">Link</th>
                      </tr>
                    </thead>
                    <tbody>
                      {concluded.map((r) => renderRow(r, "submitted"))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

          </>
        )}
      </CardContent>
    </Card>
  );
}
