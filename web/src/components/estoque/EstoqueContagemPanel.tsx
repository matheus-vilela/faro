import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EstoqueHistoricoContagem } from "@/components/estoque/EstoqueHistoricoContagem";
import { randomShortSlug } from "@/lib/randomSlug";
import { supabase } from "@/lib/supabase";
import { ClipboardList, Copy, Loader2 } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

export function EstoqueContagemPanel({ companyId }: { companyId: string }) {
  const [link, setLink] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyTick, setHistoryTick] = useState(0);

  const createLink = useCallback(async () => {
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id ?? null;

    const { data: sess, error: se } = await supabase
      .from("inventory_count_sessions")
      .insert({
        company_id: companyId,
        status: "open",
        created_by_user_id: uid,
      })
      .select("id, token")
      .single();

    if (se || !sess?.id || !sess?.token) {
      console.error(se);
      toast.error("Não foi possível criar a sessão de contagem.");
      setLoading(false);
      return;
    }

    let slug: string | null = null;
    for (let i = 0; i < 15; i++) {
      const s = randomShortSlug(8);
      const { error: le } = await supabase
        .from("inventory_count_short_links")
        .insert({
          slug: s,
          session_id: sess.id,
          token: sess.token,
        });
      if (!le) {
        slug = s;
        break;
      }
      const code = (le as { code?: string }).code;
      if (code !== "23505") {
        console.error(le);
        break;
      }
    }

    const base = window.location.origin.replace(/\/$/, "");
    const url = slug
      ? `${base}/i/${slug}`
      : `${base}/contagem-estoque/${sess.token}`;

    setLink(url);
    setLoading(false);
    setHistoryTick((t) => t + 1);
    toast.success("Link gerado. Envie para quem vai contar o estoque.");
  }, [companyId]);

  const copy = () => {
    if (!link) return;
    void navigator.clipboard.writeText(link);
    toast.success("Link copiado.");
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="h-4 w-4" />
            Contagem de inventário
          </CardTitle>
          <CardDescription>
            Gere um link para conferência física: o conferente informa o saldo
            contado por item e o sistema ajusta o estoque. No WhatsApp, envie{" "}
            <span className="font-medium text-foreground">*estoque*</span> ou{" "}
            <span className="font-medium text-foreground">*inventario*</span>{" "}
            (membros precisam da permissão em Configurações → Usuários e
            membros).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            type="button"
            onClick={() => void createLink()}
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Gerando…
              </>
            ) : (
              "Gerar novo link de contagem"
            )}
          </Button>
          {link && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input readOnly value={link} className="font-mono text-sm" />
              <Button type="button" variant="outline" onClick={copy}>
                <Copy className="mr-2 h-4 w-4" />
                Copiar
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <EstoqueHistoricoContagem
        companyId={companyId}
        refreshTrigger={historyTick}
      />
    </div>
  );
}
