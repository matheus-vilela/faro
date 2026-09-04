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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTheme } from "@/contexts/ThemeContext";
import { supabase } from "@/lib/supabase";
import { systemUnitLabel } from "@/lib/companyUnits/systemUnits";
import { ClipboardList, Loader2, ScanBarcode } from "lucide-react";
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

type AllowedUnit = {
  code: string;
  hint?: string | null;
};

type ProductLine = {
  id: string;
  line_id?: string;
  name: string;
  sku: string | null;
  unit: string;
  barcode?: string | null;
  counted_qty?: number | null;
  counted_unit_code?: string | null;
  allowed_units?: AllowedUnit[];
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
  products?: ProductLine[];
};

function publicCountErrorMessage(code: string | undefined): string {
  if (code === "closed" || code === "already_submitted") {
    return "Esta contagem já foi enviada ou o link expirou.";
  }
  if (code === "listing_required") {
    return "Esta contagem precisa de uma listagem. Peça um link gerado em Contagem.";
  }
  if (code === "group_required") {
    return "Esta contagem precisa de um grupo. Peça um link gerado em Contagem.";
  }
  if (code === "incomplete") {
    return "Ainda há itens sem quantidade.";
  }
  return "Link inválido ou expirado.";
}

function unitsForProduct(p: ProductLine): AllowedUnit[] {
  if (p.allowed_units && p.allowed_units.length > 0) return p.allowed_units;
  return [{ code: p.unit, hint: null }];
}

export function ContagemEstoquePublic() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [groupName, setGroupName] = useState("");
  const [listingName, setListingName] = useState("");
  const [assignedToName, setAssignedToName] = useState("");
  const [products, setProducts] = useState<ProductLine[]>([]);
  const [sessionStatus, setSessionStatus] = useState("open");
  const [index, setIndex] = useState(0);
  const [qtyDraft, setQtyDraft] = useState("");
  const [unitDraft, setUnitDraft] = useState("");
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
  const currentUnits = current ? unitsForProduct(current) : [];
  const currentHint =
    currentUnits.find((u) => u.code === unitDraft)?.hint ?? null;

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
    setSessionStatus(row.status ?? "open");
    setProducts(list);
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
    const units = unitsForProduct(current);
    const saved = (current.counted_unit_code ?? "").trim().toLowerCase();
    const fallback = current.unit;
    setUnitDraft(
      units.some((u) => u.code === saved) ? saved : fallback,
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
        p_counted_unit_code: unitDraft || current.unit,
      },
    );
    setSaving(false);
    if (err) {
      setError("Não foi possível salvar este item.");
      return false;
    }
    const row = res as { ok?: boolean; error?: string };
    if (!row?.ok) {
      setError(
        row?.error === "not_returned_item"
          ? "Este item não precisa de recontagem."
          : row?.error === "invalid_unit"
            ? "Esta unidade não vale para o produto. Escolha outra."
            : "Não foi possível salvar este item.",
      );
      return false;
    }

    setProducts((prev) =>
      prev.map((p) =>
        p.id === current.id
          ? {
              ...p,
              counted_qty: n,
              counted_unit_code: unitDraft || current.unit,
              recount_required: false,
            }
          : p,
      ),
    );
    return true;
  };

  const goNext = async () => {
    const ok = await confirmCurrent();
    if (!ok) return;
    if (index < queue.length - 1) {
      setIndex((i) => i + 1);
    }
  };

  const submit = async () => {
    if (!token) return;
    const ok = await confirmCurrent();
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
    const row = res as { ok?: boolean; error?: string };
    if (!row?.ok) {
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
              placeholder="Código de barras, SKU ou nome…"
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

            <label className="mt-6 block text-left text-xs font-semibold uppercase text-muted-foreground">
              Quantidade contada
            </label>
            <div className="mt-2 flex gap-2">
              <Input
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                autoFocus
                className="h-16 flex-1 text-center text-3xl font-bold tabular-nums"
                value={qtyDraft}
                onChange={(e) => setQtyDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void (isLast ? submit() : goNext());
                  }
                }}
              />
              <Select
                value={unitDraft || current.unit}
                onValueChange={setUnitDraft}
              >
                <SelectTrigger className="h-16 w-[7.5rem] shrink-0 text-base">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {currentUnits.map((u) => (
                    <SelectItem key={u.code} value={u.code}>
                      {systemUnitLabel(u.code)} ({u.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {currentHint ? (
              <p className="mt-2 text-xs text-muted-foreground">{currentHint}</p>
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
                setError(null);
              }}
            >
              Anterior
            </Button>
            {!isLast ? (
              <Button
                type="button"
                className="flex-1"
                disabled={saving || submitting}
                onClick={() => void goNext()}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Próximo"}
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
