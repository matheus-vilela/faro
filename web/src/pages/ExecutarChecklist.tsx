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
import { Checkbox } from "@/components/ui/checkbox";
import { useTheme } from "@/contexts/ThemeContext";
import { supabase } from "@/lib/supabase";
import { ListChecks } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";

function PublicPageShell({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4">
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
        className="pointer-events-none absolute inset-0 bg-size-[24px_24px] bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,var(--background)_75%)]"
        aria-hidden
      />
      <div className="relative z-10 w-full max-w-lg">{children}</div>
    </div>
  );
}

type ChecklistItemRow = {
  id: string;
  title: string;
  sort_order: number;
};

type LoadResult = {
  ok: boolean;
  run?: { status: string; submitted_at: string | null };
  checklist?: { title: string; description: string | null };
  items?: ChecklistItemRow[];
  item_completed?: Record<string, string | null>;
  error?: string;
};

export function ExecutarChecklist() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LoadResult | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
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
      "get_checklist_run_public",
      { p_token: token },
    );
    setLoading(false);
    if (err) {
      setError("Erro ao carregar");
      return;
    }
    const row = res as LoadResult;
    if (!row?.ok) {
      setError(
        row?.error === "inactive"
          ? "Checklist indisponível."
          : row?.error === "already_submitted"
            ? "Este link já foi utilizado ou o checklist já foi enviado."
            : "Link inválido ou expirado.",
      );
      setData(null);
      return;
    }
    setData(row);
    const ic = row.item_completed ?? {};
    const next: Record<string, boolean> = {};
    for (const it of row.items ?? []) {
      const v = ic[it.id];
      next[it.id] = v != null && v !== "";
    }
    setChecked(next);
    if (row.run?.status === "submitted") {
      setDone(true);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleItem = async (itemId: string, next: boolean) => {
    if (!token || data?.run?.status === "submitted") return;
    setChecked((prev) => ({ ...prev, [itemId]: next }));
    const { data: res, error: err } = await supabase.rpc(
      "set_checklist_run_item_public",
      {
        p_token: token,
        p_checklist_item_id: itemId,
        p_completed: next,
      },
    );
    if (err) {
      setChecked((prev) => ({ ...prev, [itemId]: !next }));
      return;
    }
    const r = res as { ok?: boolean; error?: string };
    if (!r?.ok) {
      setChecked((prev) => ({ ...prev, [itemId]: !next }));
    }
  };

  const submit = async () => {
    if (!token) return;
    setSubmitting(true);
    const { data: res, error: err } = await supabase.rpc(
      "submit_checklist_run_public",
      { p_token: token },
    );
    setSubmitting(false);
    if (err) {
      setError("Não foi possível enviar");
      return;
    }
    const r = res as { ok?: boolean; error?: string; missing?: number };
    if (!r?.ok) {
      if (r?.error === "incomplete") {
        setError(
          `Marque todos os itens antes de enviar.${r.missing != null ? ` Faltam ${r.missing}.` : ""}`,
        );
        return;
      }
      setError("Não foi possível concluir.");
      return;
    }
    setDone(true);
    setError(null);
  };

  if (loading) {
    return (
      <PublicPageShell>
        <p className="text-center text-sm text-muted-foreground">
          Carregando checklist…
        </p>
      </PublicPageShell>
    );
  }

  if (error && !data) {
    return (
      <PublicPageShell>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ListChecks className="h-5 w-5" />
              Checklist
            </CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      </PublicPageShell>
    );
  }

  const items = data?.items ?? [];
  const title = data?.checklist?.title ?? "Checklist";
  const desc = data?.checklist?.description?.trim();
  const allChecked =
    items.length > 0 && items.every((it) => checked[it.id] === true);
  const submitted = data?.run?.status === "submitted" || done;

  return (
    <PublicPageShell>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <ListChecks className="h-6 w-6 shrink-0" />
            {title}
          </CardTitle>
          {desc ? (
            <CardDescription className="text-pretty">{desc}</CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {submitted ? (
            <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
              Checklist enviado com sucesso. Obrigado.
            </p>
          ) : (
            <>
              <ul className="space-y-3">
                {items.map((it) => (
                  <li
                    key={it.id}
                    className="flex items-start gap-3 rounded-lg border border-border/80 bg-muted/20 p-3"
                  >
                    <Checkbox
                      checked={checked[it.id] === true}
                      onCheckedChange={(v) =>
                        void toggleItem(it.id, v === true)
                      }
                      className="mt-0.5"
                    />
                    <label
                      htmlFor={it.id}
                      className="cursor-pointer text-sm leading-snug"
                    >
                      {it.title}
                    </label>
                  </li>
                ))}
              </ul>
              <Button
                className="w-full"
                disabled={!allChecked || submitting}
                onClick={() => void submit()}
              >
                {submitting ? "Enviando…" : "Enviar checklist"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </PublicPageShell>
  );
}
