import { CreateBoletoSheet } from "@/components/CreateBoletoSheet";
import {
  MonthSelector,
  getMonthRange,
  type MonthYear,
} from "@/components/MonthSelector";
import { PAGE_SIZE, Pagination } from "@/components/Pagination";
import { Badge } from "@/components/ui/badge";
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useCompany } from "@/contexts/CompanyContext";
import { useDebounce } from "@/hooks/useDebounce";
import { supabase } from "@/lib/supabase";
import type { Boleto, PaymentType } from "@/types/expense";
import { Copy, ExternalLink, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  boleto: "Boleto",
  pix: "PIX",
  ted: "TED",
};

const STATUS_LABELS = { pending: "Pendente", paid: "Pago" };

export function Boletos() {
  const { currentCompany } = useCompany();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const expenseIdFromUrl = searchParams.get("expense");

  const now = new Date();
  const [period, setPeriod] = useState<MonthYear>({
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  });
  const [boletos, setBoletos] = useState<Boleto[]>([]);
  const [boletosCount, setBoletosCount] = useState(0);
  const [boletosPage, setBoletosPage] = useState(1);
  const [boletosSearch, setBoletosSearch] = useState("");
  const debouncedSearch = useDebounce(boletosSearch, 300);
  const [loading, setLoading] = useState(true);
  const [boletoSheetOpen, setBoletoSheetOpen] = useState(false);
  const [boletoResumo, setBoletoResumo] = useState<Boleto | null>(null);

  const fetchBoletos = useCallback(async () => {
    if (!currentCompany?.id) return;
    setLoading(true);
    const { start, end } = getMonthRange(period.month, period.year);
    let query = supabase
      .from("boletos")
      .select("*", { count: "exact" })
      .eq("company_id", currentCompany.id)
      .gte("due_date", start.slice(0, 10))
      .lte("due_date", end.slice(0, 10))
      .order("due_date", { ascending: true });
    if (debouncedSearch.trim()) {
      const term = `%${debouncedSearch.trim()}%`;
      query = query.or(`description.ilike.${term},provider.ilike.${term}`);
    }
    const { data, count } = await query.range(
      (boletosPage - 1) * PAGE_SIZE,
      boletosPage * PAGE_SIZE - 1,
    );
    setBoletos((data as Boleto[]) ?? []);
    setBoletosCount(count ?? 0);
    setLoading(false);
  }, [
    currentCompany?.id,
    period.month,
    period.year,
    debouncedSearch,
    boletosPage,
  ]);

  useEffect(() => {
    setBoletosPage(1);
  }, [debouncedSearch, period.month, period.year]);

  useEffect(() => {
    fetchBoletos();
  }, [fetchBoletos]);

  useEffect(() => {
    if (expenseIdFromUrl) setBoletoSheetOpen(true);
  }, [expenseIdFromUrl]);

  const formatDate = (s: string) =>
    new Date(s).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(v);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Contas a pagar</h1>
        <p className="text-muted-foreground">
          Cadastre contas a pagar e vincule às despesas
        </p>
      </div>

      {currentCompany?.id && (
        <CreateBoletoSheet
          open={boletoSheetOpen}
          onOpenChange={(open) => {
            setBoletoSheetOpen(open);
            if (!open && expenseIdFromUrl) navigate("/app/despesas");
          }}
          companyId={currentCompany.id}
          expenseId={expenseIdFromUrl}
          onSuccess={() => {
            fetchBoletos();
            if (expenseIdFromUrl) navigate("/app/despesas");
          }}
        />
      )}

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Contas a pagar cadastradas</CardTitle>
            <CardDescription>
              Clique no boleto para ver o resumo
            </CardDescription>
          </div>
          <div className="flex items-center gap-4">
            <MonthSelector value={period} onChange={setPeriod} />
            <Button onClick={() => setBoletoSheetOpen(true)} size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Novo boleto
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap gap-3 items-center">
            <Input
              placeholder="Filtrar por descrição ou provedor..."
              value={boletosSearch}
              onChange={(e) => setBoletosSearch(e.target.value)}
              className="max-w-sm"
            />
          </div>
          {loading ? (
            <p className="text-muted-foreground">Carregando...</p>
          ) : boletos.length === 0 ? (
            <p className="text-muted-foreground">Nenhum boleto cadastrado</p>
          ) : (
            <div className="space-y-2">
              {boletos.map((b) => (
                <div
                  key={b.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setBoletoResumo(b)}
                  onKeyDown={(e) => e.key === "Enter" && setBoletoResumo(b)}
                  className="flex items-center justify-between gap-4 rounded-lg border p-4 cursor-pointer hover:bg-muted/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{b.description}</span>
                      <span className="text-xs font-medium text-muted-foreground rounded-md bg-muted px-2 py-0.5">
                        {PAYMENT_TYPE_LABELS[b.payment_type ?? "boleto"]}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {STATUS_LABELS[b.status]}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      Venc. {formatDate(b.due_date)} •{" "}
                      {formatCurrency(b.amount)}
                      {b.provider && ` • ${b.provider}`}
                    </p>
                  </div>
                  <div onClick={(e) => e.stopPropagation()}>
                    {b.expense_id ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          navigate(`/app/despesas?expense=${b.expense_id}`)
                        }
                        title="Ir para despesa"
                      >
                        <ExternalLink className="h-5 w-5" />
                      </Button>
                    ) : (
                      <span className="text-muted-foreground text-sm">
                        Sem despesa
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {!loading && (
            <Pagination
              page={boletosPage}
              totalCount={boletosCount}
              onPageChange={setBoletosPage}
            />
          )}
        </CardContent>
      </Card>

      <Sheet
        open={!!boletoResumo}
        onOpenChange={(o) => !o && setBoletoResumo(null)}
      >
        <SheetContent className="sm:max-w-md">
          {boletoResumo && (
            <>
              <SheetHeader>
                <SheetTitle>Resumo do boleto</SheetTitle>
                <SheetDescription>Dados para pagamento</SheetDescription>
              </SheetHeader>
              <div className="space-y-6 py-6">
                <div>
                  <p className="font-semibold">{boletoResumo.description}</p>
                  <p className="text-2xl font-bold text-primary mt-1">
                    {formatCurrency(boletoResumo.amount)}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Vencimento: {formatDate(boletoResumo.due_date)}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant="secondary">
                      {
                        PAYMENT_TYPE_LABELS[
                          boletoResumo.payment_type ?? "boleto"
                        ]
                      }
                    </Badge>
                    <Badge
                      variant={
                        boletoResumo.status === "paid" ? "default" : "outline"
                      }
                    >
                      {STATUS_LABELS[boletoResumo.status]}
                    </Badge>
                    {boletoResumo.provider && (
                      <span className="text-sm text-muted-foreground">
                        {boletoResumo.provider}
                      </span>
                    )}
                  </div>
                </div>

                {boletoResumo.status === "pending" && (
                  <>
                    {(boletoResumo.payment_type ?? "boleto") === "boleto" &&
                      boletoResumo.barcode && (
                        <div className="rounded-lg border p-4 space-y-2">
                          <p className="text-sm font-medium">
                            Código de barras
                          </p>
                          <p className="text-sm font-mono break-all">
                            {boletoResumo.barcode}
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              navigator.clipboard.writeText(
                                boletoResumo.barcode ?? "",
                              );
                              toast.success("Código copiado");
                            }}
                          >
                            <Copy className="h-4 w-4 mr-2" />
                            Copiar código
                          </Button>
                        </div>
                      )}
                    {(boletoResumo.payment_type ?? "boleto") === "pix" &&
                      boletoResumo.pix_key && (
                        <div className="rounded-lg border p-4 space-y-2">
                          <p className="text-sm font-medium">Chave PIX</p>
                          <p className="text-sm font-mono break-all">
                            {boletoResumo.pix_key}
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              navigator.clipboard.writeText(
                                boletoResumo.pix_key ?? "",
                              );
                              toast.success("Chave copiada");
                            }}
                          >
                            <Copy className="h-4 w-4 mr-2" />
                            Copiar chave
                          </Button>
                        </div>
                      )}
                    {(boletoResumo.payment_type ?? "boleto") === "ted" &&
                      (boletoResumo.bank_name ||
                        boletoResumo.agency ||
                        boletoResumo.account) && (
                        <div className="rounded-lg border p-4 space-y-2">
                          <p className="text-sm font-medium">Dados bancários</p>
                          <div className="text-sm space-y-1">
                            {boletoResumo.bank_name && (
                              <p>Banco: {boletoResumo.bank_name}</p>
                            )}
                            {boletoResumo.bank_code && (
                              <p>Código: {boletoResumo.bank_code}</p>
                            )}
                            {boletoResumo.agency && (
                              <p>Agência: {boletoResumo.agency}</p>
                            )}
                            {boletoResumo.account && (
                              <p>Conta: {boletoResumo.account}</p>
                            )}
                          </div>
                        </div>
                      )}
                  </>
                )}
              </div>
              <div className="flex flex-col gap-2 pt-4">
                {boletoResumo.expense_id && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setBoletoResumo(null);
                      navigate(
                        `/app/despesas?expense=${boletoResumo.expense_id}`,
                      );
                    }}
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Ir para despesa
                  </Button>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
