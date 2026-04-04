import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { supabase } from "@/lib/supabase";
import { History, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type SessionRow = {
  id: string;
  created_at: string;
  submitted_at: string | null;
  company_member_id: string | null;
  created_by_user_id: string | null;
  company_members: { name: string } | null;
  profiles: { full_name: string | null } | null;
};

function initiatorLabel(r: SessionRow): string {
  const cm = r.company_members;
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
        created_at,
        submitted_at,
        company_member_id,
        created_by_user_id,
        company_members ( name ),
        profiles ( full_name )
      `,
      )
      .eq("company_id", companyId)
      .eq("status", "submitted")
      .order("submitted_at", { ascending: false })
      .limit(80);

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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4" />
          Histórico de contagens
        </CardTitle>
        <CardDescription>
          Contagens já enviadas: quem iniciou a sessão (WhatsApp do membro,
          usuário do painel ou proprietário) e data de envio.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando…
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma contagem concluída ainda.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <th className="p-2 font-medium">Enviada em</th>
                  <th className="p-2 font-medium">Iniciada por</th>
                  <th className="p-2 font-medium">Origem</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const origin = r.company_member_id
                    ? "WhatsApp (membro)"
                    : r.created_by_user_id
                      ? "Painel"
                      : "WhatsApp (proprietário)";
                  return (
                    <tr key={r.id} className="border-b border-border/60">
                      <td className="p-2 whitespace-nowrap text-muted-foreground">
                        {formatDt(r.submitted_at)}
                      </td>
                      <td className="p-2 font-medium">{initiatorLabel(r)}</td>
                      <td className="p-2 text-muted-foreground">{origin}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
