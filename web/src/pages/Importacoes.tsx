import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCompany } from "@/contexts/CompanyContext";
import { supabase } from "@/lib/supabase";
import { Loader2, RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

type XmlLinkPendingRow = {
  id: string;
  title: string;
  detail: string | null;
  expense_id: string | null;
  created_at: string;
};

export function Importacoes() {
  const { currentCompany } = useCompany();
  const [loading, setLoading] = useState(true);
  const [xmlLinkPendings, setXmlLinkPendings] = useState<XmlLinkPendingRow[]>([]);

  const load = useCallback(async () => {
    if (!currentCompany?.id) return;
    setLoading(true);

    const { data: pendingXml, error: pendingXmlErr } = await supabase
      .from("import_review_pending")
      .select("id, title, detail, expense_id, created_at")
      .eq("company_id", currentCompany.id)
      .eq("status", "OPEN")
      .eq("kind", "missing_product_match")
      .order("created_at", { ascending: false })
      .limit(50);

    setLoading(false);

    if (pendingXmlErr) {
      toast.error(pendingXmlErr.message);
      setXmlLinkPendings([]);
      return;
    }
    setXmlLinkPendings((pendingXml ?? []) as XmlLinkPendingRow[]);
  }, [currentCompany?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <PageShell className="space-y-6" narrow>
      <PageHeader
        title="Central de importações"
        description="Pendências de vínculo de produtos após importação de NF-e e catálogo. O processamento de XML em lote legado foi descontinuado; use a sincronização Focus no painel."
        action={(
          <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
            Atualizar
          </Button>
        )}
      />
      <Card>
        <CardHeader>
          <CardTitle>Pendências de vínculo (NF-e / catálogo)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Linhas importadas que ainda precisam de confirmação ou vínculo manual com o estoque.
            Use a despesa para ajustar itens; o painel principal continua com a lista completa e
            ações em lote.
          </p>
          <p className="text-sm">
            <Link to="/app" className="text-primary underline-offset-4 hover:underline">
              Abrir alertas no painel
            </Link>
          </p>
          {xmlLinkPendings.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma pendência aberta deste tipo.</p>
          ) : (
            <ul className="space-y-2">
              {xmlLinkPendings.map((p) => (
                <li key={p.id} className="rounded-lg border p-3 text-sm">
                  <p className="font-medium leading-snug">{p.title}</p>
                  {p.detail ? (
                    <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{p.detail}</p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{new Date(p.created_at).toLocaleString("pt-BR")}</span>
                    {p.expense_id ? (
                      <Link
                        to={`/app/despesas?expense=${encodeURIComponent(p.expense_id)}`}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        Abrir despesa
                      </Link>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
