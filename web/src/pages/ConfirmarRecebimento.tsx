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
import { supabase } from "@/lib/supabase";
import { PackageCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";

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
    const initial: Record<number, ItemStatus> = {};
    const pq: Record<number, string> = {};
    (obj.items ?? []).forEach((it, i) => {
      initial[i] = "received";
      pq[i] = String(Number(it.quantity));
    });
    setItemStatus(initial);
    setPartialQty(pq);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleConfirm = async () => {
    if (!token || !data?.items?.length) return;
    const items = data.items;
    const pItems = items.map((it, i) => {
      const st = itemStatus[i] ?? "received";
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

    const invalidPartial = pItems.some(
      (p, i) =>
        itemStatus[i] === "partial" &&
        (!Number.isFinite(p.quantity_received!) ||
          (p.quantity_received as number) <= 0 ||
          (p.quantity_received as number) >= Number(items[i].quantity)),
    );
    if (invalidPartial) {
      setError(
        "Para itens parciais, informe uma quantidade maior que zero e menor que o pedido.",
      );
      return;
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

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(v);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
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
      </div>
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
      <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
        <Card className="max-w-md w-full">
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
      </div>
    );
  }

  const items = data?.items ?? [];
  const allResponded = items.every((_, i) => itemStatus[i] !== undefined);
  const hasNotReceived = items.some((_, i) => itemStatus[i] === "not_received");
  const hasPartial = items.some((_, i) => itemStatus[i] === "partial");
  const canConfirm = data?.viewer_can_confirm !== false;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <Card className="max-w-lg w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PackageCheck className="h-5 w-5" />
            Confirmar recebimento
          </CardTitle>
          <CardDescription>
            {data?.supplier_name && `Fornecedor: ${data.supplier_name}`}
            {data?.invoice_number && ` • Nota: ${data.invoice_number}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
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
              const st = itemStatus[i] ?? "received";
              const isPartial = st === "partial";
              const isNot = st === "not_received";
              return (
                <div
                  key={it.id}
                  className={`rounded-lg border p-3 space-y-3 ${
                    isNot
                      ? "border-destructive/50 bg-destructive/5"
                      : isPartial
                        ? "border-amber-500/50 bg-amber-500/5"
                        : ""
                  }`}
                >
                  <div className="flex flex-col gap-2  sm:items-start sm:justify-between">
                    <div className="flex-1 min-w-0">
                      <span className="font-medium">
                        {it.product_name || "—"}
                      </span>
                      <span className="text-muted-foreground ml-2 text-sm">
                        Pedido: {Number(it.quantity).toLocaleString("pt-BR")} un
                        × {formatCurrency(Number(it.unit_value))}
                      </span>
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
                        Quantidade recebida (máx.{" "}
                        {Math.max(
                          0,
                          Number(it.quantity) - 0.0001,
                        ).toLocaleString("pt-BR", {
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
                        max={Number(it.quantity)}
                        placeholder="Ex.: 6"
                        value={partialQty[i] ?? ""}
                        onChange={(e) =>
                          setPartialQty((prev) => ({
                            ...prev,
                            [i]: e.target.value,
                          }))
                        }
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
    </div>
  );
}
