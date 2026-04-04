import logoDark from "@/assets/logos/faro_logo_darkmode_transp.png";
import logoLight from "@/assets/logos/faro_logo_light_transparent.png";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useTheme } from "@/contexts/ThemeContext";
import { supabase } from "@/lib/supabase";
import { ClipboardList, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";

function PublicPageShell({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  return (
    <div className="relative flex min-h-screen justify-center overflow-y-auto bg-background p-4 py-10">
      <Link
        to="/"
        className="absolute left-4 top-4 z-20 flex items-center transition-opacity hover:opacity-90 sm:left-6 sm:top-6"
        aria-label="Faro — início"
      >
        <img
          src={resolvedTheme === "dark" ? logoDark : logoLight}
          alt=""
          width={140}
          height={40}
          className="h-8 w-auto max-w-[min(140px,50vw)] object-contain object-left sm:h-12"
          decoding="async"
        />
      </Link>
      <div
        className="pointer-events-none fixed inset-0 bg-size-[24px_24px] bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)]"
        aria-hidden
      />
      <div className="relative z-10 w-full max-w-2xl pt-10">{children}</div>
    </div>
  );
}

type ProductLine = {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  current_quantity: number;
};

type LoadJson = {
  ok: boolean;
  error?: string;
  company_name?: string;
  products?: ProductLine[];
};

export function ContagemEstoquePublic() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [products, setProducts] = useState<ProductLine[]>([]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    if (!token) {
      setError("Link inválido");
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data: res, error: err } = await supabase.rpc(
      "get_inventory_count_public",
      { p_token: token },
    );
    setLoading(false);
    if (err) {
      setError("Erro ao carregar a contagem.");
      return;
    }
    const row = res as LoadJson;
    if (!row?.ok) {
      setError(
        row?.error === "closed"
          ? "Esta contagem já foi enviada ou o link expirou."
          : "Link inválido ou expirado.",
      );
      return;
    }
    const list = row.products ?? [];
    setCompanyName(row.company_name ?? "");
    setProducts(list);
    const initial: Record<string, string> = {};
    for (const p of list) {
      initial[p.id] = String(p.current_quantity ?? 0);
    }
    setCounts(initial);
  }, [token]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const submit = async () => {
    if (!token) return;
    const lines = products.map((p) => ({
      product_id: p.id,
      counted_qty: parseFloat(counts[p.id] ?? "0") || 0,
    }));
    setSubmitting(true);
    const { data: res, error: err } = await supabase.rpc(
      "submit_inventory_count_public",
      { p_token: token, p_lines: lines },
    );
    setSubmitting(false);
    if (err) {
      setError("Não foi possível enviar. Tente novamente.");
      return;
    }
    const row = res as { ok?: boolean; error?: string };
    if (!row?.ok) {
      setError(
        row?.error === "already_submitted"
          ? "Esta contagem já foi enviada."
          : "Não foi possível salvar.",
      );
      return;
    }
    setDone(true);
  };

  if (loading) {
    return (
      <PublicPageShell>
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Carregando…
        </div>
      </PublicPageShell>
    );
  }

  if (error && !done) {
    return (
      <PublicPageShell>
        <Card>
          <CardHeader>
            <CardTitle>Contagem de estoque</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      </PublicPageShell>
    );
  }

  if (done) {
    return (
      <PublicPageShell>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5" />
              Contagem enviada
            </CardTitle>
            <CardDescription>
              O estoque foi atualizado com as quantidades informadas. Obrigado.
            </CardDescription>
          </CardHeader>
        </Card>
      </PublicPageShell>
    );
  }

  return (
    <PublicPageShell>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            Contagem de estoque
          </CardTitle>
          <CardDescription>
            {companyName ? (
              <>
                <span className="font-medium text-foreground">{companyName}</span>
                {" — "}
              </>
            ) : null}
            Informe a quantidade física de cada item. O sistema calculará os
            ajustes em relação ao saldo atual.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-h-[min(60vh,480px)] space-y-3 overflow-y-auto pr-1">
            {products.map((p) => (
              <div
                key={p.id}
                className="flex flex-col gap-1 rounded-lg border border-border/80 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium leading-snug">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Sistema: {Number(p.current_quantity).toLocaleString("pt-BR")}{" "}
                    {p.unit}
                    {p.sku ? ` · ${p.sku}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-muted-foreground">Contado</span>
                  <Input
                    type="number"
                    step="0.0001"
                    min="0"
                    className="w-28 tabular-nums"
                    value={counts[p.id] ?? ""}
                    onChange={(e) =>
                      setCounts((c) => ({ ...c, [p.id]: e.target.value }))
                    }
                  />
                  <span className="text-xs text-muted-foreground">{p.unit}</span>
                </div>
              </div>
            ))}
          </div>
          {products.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum produto ativo para contar.
            </p>
          )}
          <Button
            type="button"
            className="w-full"
            disabled={submitting || products.length === 0}
            onClick={() => void submit()}
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Enviando…
              </>
            ) : (
              "Enviar contagem"
            )}
          </Button>
        </CardContent>
      </Card>
    </PublicPageShell>
  );
}
