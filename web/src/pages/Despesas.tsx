import { CreateBoletoSheet } from "@/components/CreateBoletoSheet";
import { CreateSupplierSheet } from "@/components/CreateSupplierSheet";
import { ExpenseDetailSheet } from "@/components/expenses/ExpenseDetailSheet";
import { getMonthRange, type MonthYear } from "@/components/MonthSelector";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { PAGE_SIZE, Pagination } from "@/components/Pagination";
import { ReferencePeriodCard } from "@/components/ReferencePeriodCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useCompany } from "@/contexts/CompanyContext";
import { useDebounce } from "@/hooks/useDebounce";
import { formatBoletoCategoryLabel } from "@/lib/boletoCategory";
import { maskCpfCnpj } from "@/lib/masks";
import { canGestorAccess } from "@/lib/roles";
import { supabase } from "@/lib/supabase";
import type { CompanyCategory } from "@/types/category";
import {
  isBoletoPayable,
  type Boleto,
  type Expense,
  type ExpenseItem,
  type ExpenseType,
  type PaymentType,
} from "@/types/expense";
import type { Product } from "@/types/product";
import type { Supplier } from "@/types/supplier";
import {
  Copy,
  FileText,
  MessageCircle,
  Plus,
  Trash2,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

function formatDocForDisplay(doc: string | null): string {
  if (!doc || !doc.replace(/\D/g, "")) return "";
  return maskCpfCnpj(doc);
}

const TYPE_LABELS: Record<Exclude<ExpenseType, "nota_fiscal">, string> = {
  romaneio: "Romaneio",
  recibo: "Recibo",
};

const STATUS_LABELS = {
  pending: "Pendente",
  approved: "Aprovada",
  rejected: "Recusada",
};

const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  boleto: "Boleto",
  pix: "PIX",
  ted: "TED",
};

const BOLETO_STATUS_LABELS = { pending: "Pendente", paid: "Pago" };

export function Despesas() {
  const { currentCompany, currentRole } = useCompany();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const highlightExpenseId = searchParams.get("expense");
  const isGestor = currentRole && canGestorAccess(currentRole);

  const now = new Date();
  const [period, setPeriod] = useState<MonthYear>({
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  });
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expensesCount, setExpensesCount] = useState(0);
  const [expensesPage, setExpensesPage] = useState(1);
  const [expensesSearch, setExpensesSearch] = useState("");
  const debouncedSearch = useDebounce(expensesSearch, 300);
  /** Somente despesas WhatsApp com status pendente (aguardando aprovação do proprietário). */
  const [onlyPendingApproval, setOnlyPendingApproval] = useState(false);
  const [boletos, setBoletos] = useState<Boleto[]>([]);
  const [companyCategories, setCompanyCategories] = useState<CompanyCategory[]>(
    [],
  );
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [type, setType] = useState<ExpenseType>("nota_fiscal");
  const [supplierId, setSupplierId] = useState<string>("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceSeries, setInvoiceSeries] = useState("");
  const [supplierDocument, setSupplierDocument] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [notes, setNotes] = useState("");

  // Sheet criar fornecedor (dentro do fluxo de despesa)
  const [createSupplierOpen, setCreateSupplierOpen] = useState(false);
  const [items, setItems] = useState<ExpenseItem[]>([
    { product_name: "", quantity: 1, unit_value: 0, product_id: undefined },
  ]);

  // Sheet nova despesa
  const [expenseSheetOpen, setExpenseSheetOpen] = useState(false);

  // Link boleto dialog
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [boletoSheetOpen, setBoletoSheetOpen] = useState(false);
  const [boletoExpenseId, setBoletoExpenseId] = useState<string | null>(null);
  const [selectedExpenseId, setSelectedExpenseId] = useState<string | null>(
    null,
  );
  const [boletoResumo, setBoletoResumo] = useState<Boleto | null>(null);
  const [selectedBoletoId, setSelectedBoletoId] = useState<string>("");
  const [linking, setLinking] = useState(false);
  const [detailExpenseId, setDetailExpenseId] = useState<string | null>(null);

  const getBoletoForExpense = (expenseId: string) =>
    boletos.find((b) => b.expense_id === expenseId);

  const categoriesById = useMemo(
    () => new Map(companyCategories.map((c) => [c.id, c])),
    [companyCategories],
  );

  const fetchData = useCallback(async () => {
    if (!currentCompany?.id) return;
    setLoading(true);
    const { start, end } = getMonthRange(period.month, period.year);
    let exQuery = supabase
      .from("expenses")
      .select(
        `
        *,
        expense_items (*, products (id, name, current_quantity, min_quantity)),
        suppliers (id, name, document)
      `,
        { count: "exact" },
      )
      .eq("company_id", currentCompany.id)
      .gte("created_at", start)
      .lte("created_at", end)
      .order("created_at", { ascending: false });
    if (onlyPendingApproval) {
      exQuery = exQuery
        .eq("expense_source", "whatsapp")
        .eq("status", "pending");
    }
    if (debouncedSearch.trim()) {
      const term = `%${debouncedSearch.trim()}%`;
      exQuery = exQuery.or(
        `supplier_name.ilike.${term},invoice_number.ilike.${term},display_name.ilike.${term}`,
      );
    }
    const { data: ex, count } = await exQuery.range(
      (expensesPage - 1) * PAGE_SIZE,
      expensesPage * PAGE_SIZE - 1,
    );
    const { data: bo } = await supabase
      .from("boletos")
      .select("*")
      .eq("company_id", currentCompany.id)
      .eq("flow_type", "payable");
    const { data: catRows } = await supabase
      .from("company_categories")
      .select("*")
      .eq("company_id", currentCompany.id)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    setCompanyCategories((catRows as CompanyCategory[]) ?? []);
    const { data: sup } = await supabase
      .from("suppliers")
      .select("*")
      .eq("company_id", currentCompany.id)
      .order("name");
    const { data: prod } = await supabase
      .from("products")
      .select("*")
      .eq("company_id", currentCompany.id)
      .order("name");
    setExpenses((ex as Expense[]) ?? []);
    setExpensesCount(count ?? 0);
    setBoletos((bo as Boleto[]) ?? []);
    setSuppliers((sup as Supplier[]) ?? []);
    setProducts((prod as Product[]) ?? []);
    setLoading(false);
  }, [
    currentCompany,
    period.month,
    period.year,
    debouncedSearch,
    expensesPage,
    onlyPendingApproval,
  ]);

  useEffect(() => {
    setExpensesPage(1);
  }, [debouncedSearch, period.month, period.year, onlyPendingApproval]);

  useEffect(() => {
    queueMicrotask(() => fetchData());
  }, [fetchData]);

  useEffect(() => {
    if (highlightExpenseId) {
      queueMicrotask(() => setDetailExpenseId(highlightExpenseId));
    }
  }, [highlightExpenseId]);

  useEffect(() => {
    if (highlightExpenseId && !loading && expenses.length) {
      const el = document.getElementById(highlightExpenseId);
      el?.scrollIntoView({ behavior: "smooth" });
    }
  }, [highlightExpenseId, loading, expenses.length]);

  const addItem = () =>
    setItems((prev) => [
      ...prev,
      { product_name: "", quantity: 1, unit_value: 0, product_id: undefined },
    ]);
  const removeItem = (i: number) =>
    setItems((prev) => prev.filter((_, ix) => ix !== i));
  const updateItem = (i: number, f: Partial<ExpenseItem>) =>
    setItems((prev) => prev.map((it, ix) => (ix === i ? { ...it, ...f } : it)));

  const totalItems = items.reduce(
    (s, it) => s + Number(it.quantity) * Number(it.unit_value),
    0,
  );

  const selectedSupplier = supplierId
    ? suppliers.find((s) => s.id === supplierId)
    : null;
  const canSubmit =
    items.every(
      (it) =>
        it.product_name.trim() !== "" &&
        Number(it.quantity) > 0 &&
        Number(it.unit_value) >= 0,
    ) &&
    (supplierId !== "" || supplierName.trim() !== "") &&
    (type !== "nota_fiscal" || invoiceNumber.trim() !== "");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentCompany?.id || !canSubmit) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: exp, error: expErr } = await supabase
      .from("expenses")
      .insert({
        company_id: currentCompany.id,
        created_by: user?.id ?? null,
        type,
        supplier_id: supplierId || null,
        invoice_number: type === "nota_fiscal" ? invoiceNumber : null,
        invoice_series:
          type === "nota_fiscal" ? invoiceSeries.trim() || null : null,
        supplier_document:
          ((selectedSupplier?.document ?? supplierDocument) || "").replace(
            /\D/g,
            "",
          ) || null,
        supplier_name: (selectedSupplier?.name ?? supplierName) || null,
        notes: notes || null,
        status: "pending",
        expense_source: "manual",
      })
      .select("id")
      .single();
    if (expErr) {
      console.error(expErr);
      return;
    }
    for (const it of items) {
      await supabase.from("expense_items").insert({
        expense_id: exp.id,
        product_name: it.product_name,
        quantity: it.quantity,
        unit_value: it.unit_value,
        product_id: it.product_id || null,
        stock_added: false,
      });
    }
    await supabase.from("recebimentos").insert({
      expense_id: exp.id,
    });
    setType("nota_fiscal");
    setSupplierId("");
    setInvoiceNumber("");
    setInvoiceSeries("");
    setSupplierDocument("");
    setSupplierName("");
    setNotes("");
    setItems([
      { product_name: "", quantity: 1, unit_value: 0, product_id: undefined },
    ]);
    setExpenseSheetOpen(false);
    fetchData();
  };

  const unlinkedBoletos = boletos.filter(
    (b) => !b.expense_id && isBoletoPayable(b),
  );

  const openLinkDialog = (expenseId: string) => {
    setSelectedExpenseId(expenseId);
    setSelectedBoletoId("");
    if (unlinkedBoletos.length === 0) {
      setBoletoExpenseId(expenseId);
      setBoletoSheetOpen(true);
    } else {
      setLinkDialogOpen(true);
    }
  };

  const handleLinkBoleto = async () => {
    if (!selectedExpenseId || !selectedBoletoId) return;
    setLinking(true);
    const { error } = await supabase
      .from("boletos")
      .update({ expense_id: selectedExpenseId })
      .eq("id", selectedBoletoId);
    setLinking(false);
    if (error) console.error(error);
    else {
      setLinkDialogOpen(false);
      fetchData();
    }
  };

  const handleUnlinkBoleto = async (boletoId: string) => {
    const { error } = await supabase
      .from("boletos")
      .update({ expense_id: null })
      .eq("id", boletoId);
    if (error) console.error(error);
    else fetchData();
  };

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
    <PageShell className="space-y-8 pb-0 " narrow>
      <PageHeader
        title="Despesas"
        description={
          isGestor
            ? "Revisar despesas registradas e vincular contas a pagar"
            : "Registrar despesas e vincular contas a pagar"
        }
        action={
          <Button
            type="button"
            onClick={() => setExpenseSheetOpen(true)}
            className="h-10 w-full shrink-0 sm:w-auto"
          >
            <Plus className="h-4 w-4 mr-2" />
            Nova despesa
          </Button>
        }
      />

      <ReferencePeriodCard
        value={period}
        onChange={setPeriod}
        description="Lista filtrada pelo mês de cadastro da despesa"
      />

      <Sheet open={expenseSheetOpen} onOpenChange={setExpenseSheetOpen}>
        <SheetContent className="overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5" />
              Nova despesa
            </SheetTitle>
            <SheetDescription>
              Cadastre compras, notas fiscais, romaneios ou recibos
            </SheetDescription>
          </SheetHeader>
          <form onSubmit={handleSubmit} className="space-y-6 py-4">
            <div>
              <Label>Tipo</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as ExpenseType)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nota_fiscal">Nota fiscal</SelectItem>
                  <SelectItem value="romaneio">Romaneio</SelectItem>
                  <SelectItem value="recibo">Recibo</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Fornecedor</Label>
              <Select
                value={supplierId === "__create__" ? "" : supplierId}
                onValueChange={(v) => {
                  if (v === "__create__") {
                    setCreateSupplierOpen(true);
                    return;
                  }
                  setSupplierId(v);
                  const s = suppliers.find((x) => x.id === v);
                  if (s) {
                    setSupplierName(s.name);
                    setSupplierDocument(s.document ?? "");
                  }
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selecione o fornecedor" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                      {s.document ? ` — ${s.document}` : ""}
                    </SelectItem>
                  ))}
                  <SelectItem
                    value="__create__"
                    className="text-primary font-medium"
                  >
                    <Plus className="h-4 w-4 inline mr-2" />
                    Criar fornecedor
                  </SelectItem>
                </SelectContent>
              </Select>
              {suppliers.length === 0 && !supplierId && (
                <p className="text-sm text-muted-foreground mt-1">
                  Nenhum fornecedor cadastrado.{" "}
                  <button
                    type="button"
                    onClick={() => setCreateSupplierOpen(true)}
                    className="text-primary underline"
                  >
                    Criar fornecedor
                  </button>
                </p>
              )}
              {!supplierId && suppliers.length > 0 && (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs">Nome (manual)</Label>
                    <Input
                      value={supplierName}
                      onChange={(e) => setSupplierName(e.target.value)}
                      placeholder="Ou informe manualmente"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">CNPJ/CPF (manual)</Label>
                    <Input
                      value={supplierDocument}
                      onChange={(e) =>
                        setSupplierDocument(maskCpfCnpj(e.target.value))
                      }
                      placeholder="000.000.000-00 ou 00.000.000/0001-00"
                    />
                  </div>
                </div>
              )}
            </div>

            {type === "nota_fiscal" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Nº da nota / NFC-e</Label>
                  <Input
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    placeholder="Ex: 12345"
                  />
                </div>
                <div>
                  <Label>Série</Label>
                  <Input
                    value={invoiceSeries}
                    onChange={(e) => setInvoiceSeries(e.target.value)}
                    placeholder="Ex: 1"
                  />
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between">
                <Label>Itens</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addItem}
                >
                  <Plus className="h-4 w-4 mr-1" /> Adicionar item
                </Button>
              </div>
              <div className="mt-2 space-y-3">
                {items.map((it, i) => (
                  <div key={i} className="space-y-2 rounded-lg border p-3">
                    <div className="flex gap-2 items-end">
                      <div className="flex-1">
                        <Label className="text-xs">Descrição da nota</Label>
                        <Input
                          placeholder="Produto (como vem na nota)"
                          value={it.product_name}
                          onChange={(e) =>
                            updateItem(i, { product_name: e.target.value })
                          }
                        />
                      </div>
                      <div className="w-24">
                        <Label className="text-xs">Qtd</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="Qtd"
                          value={it.quantity || ""}
                          onChange={(e) =>
                            updateItem(i, {
                              quantity: parseFloat(e.target.value) || 0,
                            })
                          }
                        />
                      </div>
                      <div className="w-28">
                        <Label className="text-xs">Valor un.</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="Valor un."
                          value={it.unit_value || ""}
                          onChange={(e) =>
                            updateItem(i, {
                              unit_value: parseFloat(e.target.value) || 0,
                            })
                          }
                        />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeItem(i)}
                        disabled={items.length === 1}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                    <div>
                      <Label className="text-xs">
                        Vincular ao produto (estoque)
                      </Label>
                      <Select
                        value={it.product_id ?? "__none__"}
                        onValueChange={(v) =>
                          updateItem(i, {
                            product_id: v === "__none__" ? undefined : v,
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Não vincular" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Não vincular</SelectItem>
                          {products
                            .filter((p) => p.is_active !== false)
                            .map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.name}
                                {p.sku && ` (${p.sku})`} — Estoque:{" "}
                                {Number(p.current_quantity).toLocaleString(
                                  "pt-BR",
                                )}{" "}
                                {p.unit}
                                {p.last_unit_value != null &&
                                  p.last_unit_value > 0 &&
                                  ` • Último: ${Number(p.last_unit_value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground mt-1">
                        Ao vincular, o estoque será atualizado quando o
                        recebimento for confirmado
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                Total: {formatCurrency(totalItems)}
              </p>
            </div>

            <div>
              <Label>Observações</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Opcional"
              />
            </div>

            <SheetFooter>
              <Button type="submit" disabled={!canSubmit}>
                Registrar despesa
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      {currentCompany?.id && (
        <CreateSupplierSheet
          open={createSupplierOpen}
          onOpenChange={setCreateSupplierOpen}
          companyId={currentCompany.id}
          onSuccess={(supplier) => {
            setSuppliers((prev) =>
              [...prev, supplier].sort((a, b) => a.name.localeCompare(b.name)),
            );
            setSupplierId(supplier.id);
            setSupplierName(supplier.name);
            setSupplierDocument(supplier.document ?? "");
          }}
        />
      )}

      {/* Listagem */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Todas as despesas
            </CardTitle>
            <CardDescription>
              {onlyPendingApproval
                ? "Somente importações pelo WhatsApp pendentes de aprovação do proprietário."
                : "Clique no ícone de boleto para vincular"}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap gap-4 items-center justify-between">
            <Input
              placeholder="Filtrar por fornecedor ou nota..."
              value={expensesSearch}
              onChange={(e) => setExpensesSearch(e.target.value)}
              className="max-w-sm"
            />
            <div className="flex items-center gap-2 shrink-0">
              <Switch
                id="filter-pending-approval"
                checked={onlyPendingApproval}
                onCheckedChange={setOnlyPendingApproval}
              />
              <Label
                htmlFor="filter-pending-approval"
                className="text-sm font-normal cursor-pointer leading-snug"
              >
                Aguardando aprovação
              </Label>
            </div>
          </div>
          {loading ? (
            <p className="text-muted-foreground">Carregando...</p>
          ) : expenses.length === 0 ? (
            <p className="text-muted-foreground">
              {onlyPendingApproval
                ? "Nenhuma despesa aguardando aprovação do proprietário."
                : "Nenhuma despesa cadastrada"}
            </p>
          ) : (
            <div className="space-y-2">
              {expenses.map((exp) => {
                const isHighlight = highlightExpenseId === exp.id;
                const boleto = getBoletoForExpense(exp.id);
                const linked = !!boleto;
                const pendingOwnerApproval =
                  exp.expense_source === "whatsapp" && exp.status === "pending";
                return (
                  <div
                    key={exp.id}
                    id={exp.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setDetailExpenseId(exp.id)}
                    onKeyDown={(e) =>
                      e.key === "Enter" && setDetailExpenseId(exp.id)
                    }
                    className={`flex items-center justify-between gap-4 rounded-lg border p-4 transition-colors cursor-pointer ${"hover:bg-muted/50"} ${isHighlight ? "" : ""}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium flex flex-wrap items-center gap-2">
                        <span>
                          {exp.supplier_name ||
                            TYPE_LABELS[exp.type as keyof typeof TYPE_LABELS] ||
                            "Sem fornecedor"}
                        </span>
                      </p>
                      {pendingOwnerApproval && (
                        <span
                          className="inline-flex items-center gap-1 rounded-md border border-amber-600/25 bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-950 shadow-sm dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100 mt-1"
                          title="Importação pelo WhatsApp — aguardando aprovação do proprietário "
                        >
                          <MessageCircle
                            className="h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-300"
                            aria-hidden
                          />
                          Pendente de aprovação
                        </span>
                      )}
                      {exp.supplier_document && (
                        <p className="text-sm text-muted-foreground mt-0.5">
                          {formatDocForDisplay(exp.supplier_document)}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium">
                        {formatCurrency(
                          exp.expense_items?.reduce(
                            (s, it) =>
                              s + Number(it.quantity) * Number(it.unit_value),
                            0,
                          ) ?? 0,
                        )}
                      </span>
                      <Badge
                        variant={
                          exp.status === "approved"
                            ? "default"
                            : exp.status === "rejected"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {STATUS_LABELS[exp.status]}
                      </Badge>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (linked) setBoletoResumo(boleto!);
                          else openLinkDialog(exp.id);
                        }}
                        className="p-2 rounded-md hover:bg-muted transition-colors shrink-0"
                        title={
                          linked ? "Ver resumo do boleto" : "Vincular boleto"
                        }
                      >
                        <FileText
                          className={`h-5 w-5 ${
                            linked ? "text-green-600" : "text-red-600"
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {!loading && (
            <Pagination
              page={expensesPage}
              totalCount={expensesCount}
              onPageChange={setExpensesPage}
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vincular boleto à despesa</DialogTitle>
            <DialogDescription>
              Selecione uma conta a pagar para vincular ou cadastre uma nova no
              Fluxo de Caixa.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label>Boleto</Label>
            <Select
              value={selectedBoletoId}
              onValueChange={setSelectedBoletoId}
            >
              <SelectTrigger className="w-full mt-2">
                <SelectValue placeholder="Selecione um boleto" />
              </SelectTrigger>
              <SelectContent>
                {unlinkedBoletos.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    [{formatBoletoCategoryLabel(b, categoriesById)}]{" "}
                    {b.description} - {formatCurrency(b.amount)} (venc.{" "}
                    {formatDate(b.due_date)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {unlinkedBoletos.length === 0 && (
              <p className="text-sm text-muted-foreground mt-2">
                Não há contas a pagar disponíveis. Cadastre no Fluxo de Caixa.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (selectedExpenseId) {
                  setBoletoExpenseId(selectedExpenseId);
                  setLinkDialogOpen(false);
                  setBoletoSheetOpen(true);
                } else {
                  setLinkDialogOpen(false);
                  navigate("/app/fluxo-de-caixa");
                }
              }}
            >
              Cadastrar boleto
            </Button>
            <Button
              onClick={handleLinkBoleto}
              disabled={!selectedBoletoId || linking}
            >
              {linking ? "Vinculando..." : "Vincular"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {currentCompany?.id && (
        <CreateBoletoSheet
          open={boletoSheetOpen}
          onOpenChange={(open) => {
            setBoletoSheetOpen(open);
            if (!open) setBoletoExpenseId(null);
          }}
          companyId={currentCompany.id}
          expenseId={boletoExpenseId}
          onSuccess={() => fetchData()}
        />
      )}

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
                      {BOLETO_STATUS_LABELS[boletoResumo.status]}
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
              <SheetFooter className="flex-col sm:flex-row gap-2">
                <Button
                  variant="outline"
                  onClick={() => navigate("/app/fluxo-de-caixa")}
                >
                  Ir para Fluxo de Caixa
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    if (boletoResumo) handleUnlinkBoleto(boletoResumo.id);
                    setBoletoResumo(null);
                    fetchData();
                  }}
                >
                  Desvincular boleto
                </Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>

      <ExpenseDetailSheet
        expenseId={detailExpenseId}
        onClose={() => {
          setDetailExpenseId(null);
          if (highlightExpenseId) {
            navigate("/app/despesas", { replace: true });
          }
        }}
        onRefresh={fetchData}
      />
    </PageShell>
  );
}
