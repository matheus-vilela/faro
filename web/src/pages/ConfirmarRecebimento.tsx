import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { supabase } from "@/lib/supabase";
import { PackageCheck } from "lucide-react";
import { useEffect, useState } from "react";
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
}

export function ConfirmarRecebimento() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<RecebimentoData | null>(null);
  type ItemStatus = "received" | "not_received";
  const [itemStatus, setItemStatus] = useState<Record<number, ItemStatus>>({});
  const [confirming, setConfirming] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) {
      queueMicrotask(() => {
        setError("Link inválido");
        setLoading(false);
      });
      return;
    }
    const load = async () => {
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
        return;
      }
      setData(obj);
      const initial: Record<number, ItemStatus> = {};
      (obj.items ?? []).forEach((_, i) => {
        initial[i] = "received";
      });
      setItemStatus(initial);
    };
    load();
  }, [token]);

  const handleConfirm = async () => {
    if (!token || !data?.items?.length) return;
    const items = data.items;
    const pItems = items.map((it, i) => ({
      expense_item_id: it.id,
      status: itemStatus[i] ?? "received",
    }));
    setConfirming(true);
    setError(null);
    const { data: res, error: err } = await supabase.rpc(
      "confirmar_recebimento",
      {
        p_token: token,
        p_items: pItems,
      },
    );
    setConfirming(false);
    if (err) {
      setError("Erro ao confirmar");
      return;
    }
    const result = res as { success?: boolean; error?: string };
    if (!result?.success) {
      setError(result?.error ?? "Erro ao confirmar");
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
      (_, i) => itemStatus[i] === "not_received"
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
              {hadNotReceived
                ? "Você registrou o recebimento. O gestor será alertado sobre os itens não recebidos."
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
          <p className="text-sm text-muted-foreground">
            Para cada item, informe se recebeu ou não.
            <br />
            Itens não recebidos geram alerta para o gestor.
          </p>

          <div className="space-y-3">
            <p className="font-medium">Itens:</p>
            {items.map((it, i) => (
              <div
                key={it.id}
                className={`rounded-lg border p-3 ${
                  itemStatus[i] === "not_received"
                    ? "border-destructive/50 bg-destructive/5"
                    : ""
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1">
                    <span className="font-medium">{it.product_name || "—"}</span>
                    <span className="text-muted-foreground ml-2">
                      {it.quantity} un × {formatCurrency(Number(it.unit_value))}
                    </span>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      type="button"
                      variant={
                        itemStatus[i] === "received" ? "default" : "outline"
                      }
                      size="sm"
                      onClick={() =>
                        setItemStatus((prev) => ({ ...prev, [i]: "received" }))
                      }
                    >
                      Recebido
                    </Button>
                    <Button
                      type="button"
                      variant={
                        itemStatus[i] === "not_received"
                          ? "destructive"
                          : "outline"
                      }
                      size="sm"
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
              </div>
            ))}
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
            onClick={handleConfirm}
            disabled={!allResponded || confirming}
          >
            {confirming ? "Confirmando..." : "Confirmar recebimento"}
          </Button>
          {hasNotReceived && (
            <p className="text-xs text-amber-600 text-center">
              O gestor será alertado sobre os itens não recebidos.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
