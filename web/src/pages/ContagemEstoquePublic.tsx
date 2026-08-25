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
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Loader2,
  ScanBarcode,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
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
      <div className="relative z-10 w-full max-w-md pt-10">{children}</div>
    </div>
  );
}

type ProductLine = {
  id: string;
  line_id?: string;
  name: string;
  sku: string | null;
  unit: string;
  barcode?: string | null;
  counted_qty?: number | null;
  in_band?: boolean | null;
  recount_required?: boolean;
  sort_order?: number;
};

type LoadJson = {
  ok: boolean;
  error?: string;
  status?: string;
  company_name?: string;
  group_name?: string;
  listing_name?: string;
  assigned_to_name?: string;
  validate_live?: boolean;
  products?: ProductLine[];
};

function publicCountErrorMessage(code: string | undefined): string {
  if (code === "closed" || code === "already_submitted") {
    return "Esta contagem já foi enviada ou o link expirou.";
  }
  if (code === "listing_required") {
    return "Esta contagem precisa de uma listagem. Peça um link gerado em Contagem (por grupo ou listagem).";
  }
  if (code === "group_required") {
    return "Esta contagem precisa de um grupo. Peça um link gerado em Contagem.";
  }
  if (code === "out_of_band") {
    return "Há itens fora da faixa — confira de novo antes de enviar.";
  }
  if (code === "incomplete") {
    return "Ainda há itens sem quantidade.";
  }
  return "Link inválido ou expirado.";
}

type BandSignal = "ok" | "out" | null;

export function ContagemEstoquePublic() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [groupName, setGroupName] = useState("");
  const [listingName, setListingName] = useState("");
  const [assignedToName, setAssignedToName] = useState("");
  const [products, setProducts] = useState<ProductLine[]>([]);
  const [validateLive, setValidateLive] = useState(true);
  const [sessionStatus, setSessionStatus] = useState("open");
  const [index, setIndex] = useState(0);
  const [qtyDraft, setQtyDraft] = useState("");
  const [band, setBand] = useState<BandSignal>(null);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [barcodeQuery, setBarcodeQuery] = useState("");

  const queue = useMemo(() => {
    if (sessionStatus === "returned") {
      return products.filter((p) => p.recount_required);
    }
    return products;
  }, [products, sessionStatus]);

  const current = queue[index] ?? null;

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
      setError(publicCountErrorMessage(row?.error));
      return;
    }
    const list = row.products ?? [];
    setCompanyName(row.company_name ?? "");
    setGroupName((row.group_name ?? "").trim());
    setListingName((row.listing_name ?? "").trim());
    setAssignedToName((row.assigned_to_name ?? "").trim());
    setValidateLive(row.validate_live !== false);
    setSessionStatus(row.status ?? "open");
    setProducts(list);
    setBand(null);
    setQtyDraft("");
    setIndex(0);
  }, [token]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  useEffect(() => {
    if (!current) return;
    setQtyDraft(
      current.counted_qty != null && current.counted_qty !== undefined
        ? String(current.counted_qty)
        : "",
    );
    setBand(
      current.in_band === true ? "ok" : current.in_band === false ? "out" : null,
    );
  }, [current?.id]);

  const confirmCurrent = async (): Promise<boolean> => {
    if (!token || !current) return false;
    const n = parseFloat(qtyDraft.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) {
      setError("Informe uma quantidade válida.");
      return false;
    }
    setSaving(true);
    setError(null);
    const { data: res, error: err } = await supabase.rpc(
      "set_inventory_count_line_public",
      {
        p_token: token,
        p_product_id: current.id,
        p_counted_qty: n,
      },
    );
    setSaving(false);
    if (err) {
      setError("Não foi possível salvar este item.");
      return false;
    }
    const row = res as {
      ok?: boolean;
      error?: string;
      in_band?: boolean | null;
      recount_required?: boolean;
    };
    if (!row?.ok) {
      setError(
        row?.error === "not_returned_item"
          ? "Este item não precisa de recontagem."
          : "Não foi possível salvar este item.",
      );
      return false;
    }

    const inBand =
      row.in_band === true ? "ok" : row.in_band === false ? "out" : null;
    setBand(inBand);
    setProducts((prev) =>
      prev.map((p) =>
        p.id === current.id
          ? {
              ...p,
              counted_qty: n,
              in_band: row.in_band ?? null,
              recount_required: Boolean(row.recount_required),
            }
          : p,
      ),
    );

    if (validateLive && row.in_band === false) {
      setError(null);
      return false;
    }
    return true;
  };

  const goNext = async () => {
    const ok = await confirmCurrent();
    if (!ok) return;
    if (index < queue.length - 1) {
      setIndex((i) => i + 1);
      setBand(null);
    }
  };

  const submit = async () => {
    if (!token) return;
    const ok = await confirmCurrent();
    if (!ok && validateLive && band === "out") return;
    if (!ok) return;

    setSubmitting(true);
    const { data: res, error: err } = await supabase.rpc(
      "submit_inventory_count_for_approval",
      {
        p_token: token,
        p_inventory_count_group_id: null,
      },
    );
    setSubmitting(false);
    if (err) {
      setError("Não foi possível enviar. Tente novamente.");
      return;
    }
    const row = res as { ok?: boolean; error?: string; count?: number };
    if (!row?.ok) {
      if (row?.error === "out_of_band") {
        setError(
          `${row.count ?? 1} item(ns) fora da faixa — confira de novo antes de enviar.`,
        );
        return;
      }
      if (row?.error === "incomplete") {
        setError("Ainda há itens sem quantidade.");
        return;
      }
      if (row?.error === "group_required" || row?.error === "listing_required") {
        setError(publicCountErrorMessage(row.error));
        return;
      }
      setError(
        row?.error === "already_submitted"
          ? "Esta contagem já foi enviada."
          : "Não foi possível salvar.",
      );
      return;
    }
    setDone(true);
  };

  const jumpBarcode = () => {
    const q = barcodeQuery.trim();
    if (!q) return;
    const found = queue.findIndex(
      (p) =>
        (p.barcode && p.barcode === q) ||
        (p.sku && p.sku.toLowerCase() === q.toLowerCase()) ||
        p.name.toLowerCase().includes(q.toLowerCase()),
    );
    if (found < 0) {
      setError("Item não encontrado nesta contagem.");
      return;
    }
    setError(null);
    setIndex(found);
    setBarcodeQuery("");
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

  if (error && !current && !done) {
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
              Enviada para aprovação do responsável. O estoque só muda depois da
              conferência. Obrigado!
            </CardDescription>
          </CardHeader>
        </Card>
      </PublicPageShell>
    );
  }

  if (!current) {
    return (
      <PublicPageShell>
        <Card>
          <CardHeader>
            <CardTitle>Contagem de estoque</CardTitle>
            <CardDescription>
              {sessionStatus === "returned"
                ? "Nenhum item pendente de recontagem."
                : "Nenhum produto para contar."}
            </CardDescription>
          </CardHeader>
        </Card>
      </PublicPageShell>
    );
  }

  const isLast = index >= queue.length - 1;
  const progressLabel = `${index + 1} de ${queue.length}`;

  return (
    <PublicPageShell>
      <Card>
        <CardHeader className="space-y-2">
          <CardTitle className="flex items-center gap-2 text-xl">
            <ClipboardList className="h-5 w-5" />
            Contagem
          </CardTitle>
          <CardDescription className="space-y-1">
            {companyName ? (
              <p className="font-medium text-foreground">{companyName}</p>
            ) : null}
            {groupName ? <p>Grupo: {groupName}</p> : null}
            {listingName ? <p>Listagem: {listingName}</p> : null}
            {assignedToName ? <p>Operador: {assignedToName}</p> : null}
            {sessionStatus === "returned" ? (
              <p className="text-amber-700 dark:text-amber-400">
                Recontagem: confira só os itens devolvidos (sem ver o esperado).
              </p>
            ) : (
              <p>Um item por vez. O número esperado fica oculto.</p>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center gap-2">
            <ScanBarcode className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Código de barras ou nome…"
              value={barcodeQuery}
              onChange={(e) => setBarcodeQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  jumpBarcode();
                }
              }}
              className="flex-1"
            />
            <Button type="button" variant="secondary" onClick={jumpBarcode}>
              Ir
            </Button>
          </div>

          <div className="rounded-2xl border bg-muted/30 p-5 text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {progressLabel}
            </p>
            <h2 className="mt-2 text-2xl font-bold leading-tight">
              {current.name}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {current.unit}
              {current.sku ? ` · ${current.sku}` : ""}
            </p>

            <label className="mt-6 block text-left text-xs font-semibold uppercase text-muted-foreground">
              Quantidade contada
            </label>
            <Input
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              autoFocus
              className="mt-2 h-16 text-center text-3xl font-bold tabular-nums"
              value={qtyDraft}
              onChange={(e) => {
                setQtyDraft(e.target.value);
                setBand(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void (isLast ? submit() : goNext());
                }
              }}
            />

            {validateLive && band === "ok" ? (
              <div className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
                Dentro do esperado
              </div>
            ) : null}
            {validateLive && band === "out" ? (
              <div className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4" />
                Fora da faixa — confira de novo
              </div>
            ) : null}
          </div>

          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : null}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              disabled={index === 0 || saving || submitting}
              onClick={() => {
                setIndex((i) => Math.max(0, i - 1));
                setBand(null);
                setError(null);
              }}
            >
              Anterior
            </Button>
            {!isLast ? (
              <Button
                type="button"
                className={cn("flex-1")}
                disabled={saving || submitting}
                onClick={() => void goNext()}
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : band === "out" && validateLive ? (
                  "Recontar"
                ) : (
                  "Próximo"
                )}
              </Button>
            ) : (
              <Button
                type="button"
                className="flex-1"
                disabled={saving || submitting}
                onClick={() => void submit()}
              >
                {submitting || saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Enviar p/ aprovação"
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </PublicPageShell>
  );
}
