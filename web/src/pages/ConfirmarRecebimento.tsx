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
import { Label } from "@/components/ui/label";
import { useTheme } from "@/contexts/ThemeContext";
import { supabase } from "@/lib/supabase";
import { Building2, FileText, PackageCheck } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";

/** Mesmo fundo de grade + vinheta da tela de login */
function RecebimentoPageShell({ children }: { children: ReactNode }) {
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
      <div className="relative z-10 w-full">{children}</div>
    </div>
  );
}

interface RecebimentoItem {
  id: string;
  product_name: string;
  quantity: number;
  unit_value: number;
}

interface RecebimentoData {
  id?: string;
  expense_id?: string;
  status?: string;
  supplier_name?: string;
  invoice_number?: string;
  notes?: string;
  created_at?: string;
  items?: RecebimentoItem[];
  assigned_company_member_id?: string | null;
  assigned_member_name?: string | null;
  viewer_can_confirm?: boolean;
}

type ItemStatus = "received" | "partial" | "not_received";

export function ConfirmarRecebimento() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<RecebimentoData | null>(null);
  const [itemStatus, setItemStatus] = useState<Record<number, ItemStatus>>({});
  /** Quantidade recebida quando status é parcial (texto do input) */
  const [partialQty, setPartialQty] = useState<Record<number, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [success, setSuccess] = useState(false);

  const load = useCallback(async () => {
    if (!token) {
      setError("Link inválido");
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data: res, error: err } = await supabase.rpc(
      "get_recebimento_by_token",
      {
        p_token: token,
      },
    );
    setLoading(false);
    if (err) {
      setError("Erro ao carregar");
      return;
    }
    const obj = res as RecebimentoData & { error?: string };
    if (obj?.error) {
      setError(obj.error);
      setData(null);
      return;
    }
    setData(obj);
    setError(null);
    const pq: Record<number, string> = {};
    (obj.items ?? []).forEach((it, i) => {
      pq[i] = String(Number(it.quantity));
    });
    setItemStatus({});
    setPartialQty(pq);
  }, [token]);

  useEffect(() => {
    queueMicrotask(() => load());
  }, [load]);

  const handleConfirm = async () => {
    if (!token || !data?.items?.length) return;
    const items = data.items;
    if (!items.every((_, i) => itemStatus[i] !== undefined)) return;
    const pItems = items.map((it, i) => {
      const st = itemStatus[i]!;
      const base: {
        expense_item_id: string;
        status: ItemStatus;
        quantity_received?: number;
      } = {
        expense_item_id: it.id,
        status: st,
      };
      if (st === "partial") {
        const raw = partialQty[i]?.replace(",", ".").trim() ?? "";
        const n = parseFloat(raw);
        if (!Number.isFinite(n)) {
          return { ...base, quantity_received: NaN };
        }
        base.quantity_received = n;
      }
      return base;
    });

    for (let i = 0; i < pItems.length; i++) {
      if (itemStatus[i] !== "partial") continue;
      const p = pItems[i];
      const maxPedido = Number(items[i].quantity);
      const n = p.quantity_received as number;
      if (!Number.isFinite(n)) {
        setError("Informe uma quantidade válida para os itens parciais.");
        return;
      }
      if (n <= 0) {
        setError(
          "Para itens parciais, a quantidade recebida deve ser maior que zero.",
        );
        return;
      }
      if (n > maxPedido) {
        setError(
          "A quantidade recebida não pode ser maior que a quantidade pedida no item.",
        );
        return;
      }
      if (n >= maxPedido) {
        setError(
          'Para receber a quantidade total do item, use o botão "Recebido".',
        );
        return;
      }
    }

    setConfirming(true);
    setError(null);
    const { data: res, error: err } = await supabase.rpc(
      "confirmar_recebimento",
      {
        p_token: token,
        p_items: pItems.map((p) => {
          const row: Record<string, unknown> = {
            expense_item_id: p.expense_item_id,
            status: p.status,
          };
          if (p.status === "partial" && p.quantity_received != null) {
            row.quantity_received = p.quantity_received;
          }
          return row;
        }),
      },
    );
    setConfirming(false);
    if (err) {
      setError("Erro ao confirmar");
      return;
    }
    const result = res as { success?: boolean; error?: string };
    if (!result?.success) {
      setError(result?.error ?? "Não foi possível confirmar.");
      return;
    }
    setSuccess(true);
    setData((prev) => (prev ? { ...prev, status: "received" } : null));
  };

  if (loading) {
    return (
      <RecebimentoPageShell>
        <div className="flex justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      </RecebimentoPageShell>
    );
  }

  if (error && !data) {
    return (
      <RecebimentoPageShell>
        <Card className="mx-auto max-w-md w-full">
          <CardHeader>
            <CardTitle>Link inválido ou expirado</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Entre em contato com quem solicitou para receber um novo link.
            </p>
          </CardContent>
        </Card>
      </RecebimentoPageShell>
    );
  }

  if (success || data?.status === "received") {
    const hadNotReceived = (data?.items ?? []).some(
      (_, i) => itemStatus[i] === "not_received",
    );
    const hadPartial = (data?.items ?? []).some(
      (_, i) => itemStatus[i] === "partial",
    );
    return (
      <RecebimentoPageShell>
        <Card className="mx-auto max-w-md w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-600">
              <PackageCheck className="h-5 w-5" />
              Recebimento confirmado
            </CardTitle>
            <CardDescription>
              {hadNotReceived || hadPartial
                ? "Você registrou o recebimento. O gestor será alertado sobre faltas ou quantidades parciais."
                : "Você validou o recebimento de todos os itens. Obrigado!"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Este link não pode mais ser utilizado.
            </p>
          </CardContent>
        </Card>
      </RecebimentoPageShell>
    );
  }

  const items = data?.items ?? [];
  const allResponded = items.every(
    (_, i) =>
      itemStatus[i] === "received" ||
      itemStatus[i] === "partial" ||
      itemStatus[i] === "not_received",
  );
  const hasNotReceived = items.some((_, i) => itemStatus[i] === "not_received");
  const hasPartial = items.some((_, i) => itemStatus[i] === "partial");
  const canConfirm = data?.viewer_can_confirm !== false;

  return (
    <RecebimentoPageShell>
      <Card className="mx-auto max-w-lg w-full overflow-hidden border-border/80 shadow-md">
        <CardHeader className="space-y-4 pb-2">
          <CardTitle className="flex items-center gap-2 text-xl sm:text-2xl">
            <PackageCheck className="h-6 w-6 shrink-0 text-primary" />
            Confirmar recebimento
          </CardTitle>
          <CardDescription className="text-base">
            Confira o fornecedor e a identificação da compra antes de marcar os
            itens.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 pt-0">
          <div className="rounded-xl border-2 border-primary/35 bg-linear-to-br from-primary/12 via-primary/5 to-background p-4 shadow-sm ring-1 ring-primary/10">
            <div className="space-y-4">
              <div className="flex gap-3">
                <div
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/20 text-primary"
                  aria-hidden
                >
                  <Building2 className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                    Fornecedor
                  </p>
                  <p className="mt-0.5 text-lg font-semibold leading-snug text-foreground sm:text-xl">
                    {data?.supplier_name?.trim() || "—"}
                  </p>
                </div>
              </div>
              <div className="h-px bg-border/80" />
              <div className="flex gap-3">
                <div
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/20 text-primary"
                  aria-hidden
                >
                  <FileText className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                    Identificação
                  </p>
                  <p className="mt-0.5 text-base font-semibold tabular-nums text-foreground sm:text-lg">
                    {data?.invoice_number?.trim()
                      ? `NF ${data.invoice_number}`
                      : "—"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Nota fiscal ou número de referência da compra
                  </p>
                </div>
              </div>
            </div>
          </div>
          {/* {hasMemberRef && (
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                Membro de referência:{" "}
              </span>
              {data?.assigned_member_name?.trim() || "—"}
              <p className="mt-1 text-xs">
                Apenas identificação no Faro; qualquer pessoa com este link pode
                confirmar.
              </p>
            </div>
          )} */}

          <p className="text-sm text-muted-foreground">
            Para cada item, informe se recebeu tudo, uma parte da quantidade ou
            nada. Faltas e parciais geram alerta para o gestor (ex.: pediu 10 e
            chegaram 6 — informe 6 em &quot;Parcial&quot;).
          </p>

          <div className="space-y-3">
            <p className="font-medium">Itens:</p>
            {items.map((it, i) => {
              const st = itemStatus[i];
              const isPartial = st === "partial";
              const isNot = st === "not_received";
              const maxPedido = Math.max(0, Number(it.quantity));
              return (
                <div
                  key={it.id}
                  className={`rounded-lg border p-3 space-y-3 ${
                    isNot
                      ? "border-destructive/50 bg-destructive/5"
                      : isPartial
                        ? "border-amber-500/50 bg-amber-500/5"
                        : st === "received"
                          ? "border-border bg-muted/20"
                          : "border-dashed border-muted-foreground/35 bg-muted/10"
                  }`}
                >
                  <div className="flex flex-col gap-2  sm:items-start sm:justify-between">
                    <div className="flex-1 min-w-0 space-y-1.5 w-full ">
                      <div className="flex items-start justify-between gap-3">
                        <p className="min-w-0 flex-1 font-medium leading-snug">
                          {it.product_name || "—"}
                        </p>
                        <span className="inline-flex shrink-0 items-baseline gap-1.5 rounded-md border border-primary/35 bg-primary/12 px-2.5 py-1 shadow-sm">
                          <span className="text-lg font-bold tabular-nums leading-none text-primary sm:text-xl">
                            {Number(it.quantity).toLocaleString("pt-BR", {
                              maximumFractionDigits: 4,
                            })}
                          </span>
                          <span className="text-xs font-semibold text-primary/85">
                            un
                          </span>
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 shrink-0">
                      <Button
                        type="button"
                        variant={st === "received" ? "default" : "outline"}
                        size="sm"
                        disabled={!canConfirm}
                        onClick={() =>
                          setItemStatus((prev) => ({
                            ...prev,
                            [i]: "received",
                          }))
                        }
                      >
                        Recebido
                      </Button>
                      <Button
                        type="button"
                        variant={isPartial ? "default" : "outline"}
                        size="sm"
                        className={
                          isPartial
                            ? "bg-amber-600 hover:bg-amber-700 text-white"
                            : ""
                        }
                        disabled={!canConfirm}
                        onClick={() =>
                          setItemStatus((prev) => ({ ...prev, [i]: "partial" }))
                        }
                      >
                        Parcial
                      </Button>
                      <Button
                        type="button"
                        variant={isNot ? "destructive" : "outline"}
                        size="sm"
                        disabled={!canConfirm}
                        onClick={() =>
                          setItemStatus((prev) => ({
                            ...prev,
                            [i]: "not_received",
                          }))
                        }
                      >
                        Não recebi
                      </Button>
                    </div>
                  </div>
                  {isPartial && (
                    <div className="space-y-1.5 pt-1 border-t border-border/60">
                      <Label htmlFor={`qty-${i}`} className="text-xs">
                        Quantidade recebida (máximo:{" "}
                        {maxPedido.toLocaleString("pt-BR", {
                          maximumFractionDigits: 4,
                        })}{" "}
                        un)
                      </Label>
                      <Input
                        id={`qty-${i}`}
                        type="number"
                        inputMode="decimal"
                        step="any"
                        min={0.0001}
                        max={maxPedido || undefined}
                        placeholder="Ex.: 6"
                        value={partialQty[i] ?? ""}
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (raw === "" || raw === "-" || raw === ".") {
                            setPartialQty((prev) => ({
                              ...prev,
                              [i]: raw,
                            }));
                            return;
                          }
                          const n = parseFloat(raw.replace(",", "."));
                          if (
                            Number.isFinite(n) &&
                            maxPedido > 0 &&
                            n > maxPedido
                          ) {
                            setPartialQty((prev) => ({
                              ...prev,
                              [i]: String(maxPedido),
                            }));
                            return;
                          }
                          setPartialQty((prev) => ({
                            ...prev,
                            [i]: raw,
                          }));
                        }}
                        disabled={!canConfirm}
                        className="max-w-[12rem]"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {data?.notes && (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium">Observações:</span> {data.notes}
            </p>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button
            className="w-full"
            size="lg"
            onClick={() => void handleConfirm()}
            disabled={!canConfirm || !allResponded || confirming}
          >
            {confirming ? "Confirmando..." : "Confirmar recebimento"}
          </Button>
          {(hasNotReceived || hasPartial) && canConfirm && (
            <p className="text-xs text-amber-600 text-center">
              O gestor será alertado sobre itens não recebidos ou quantidades
              abaixo do pedido.
            </p>
          )}
        </CardContent>
      </Card>
    </RecebimentoPageShell>
  );
}
