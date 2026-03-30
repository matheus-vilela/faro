import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { CreateBoletoSheet } from "@/components/CreateBoletoSheet";
import { CreateSupplierSheet } from "@/components/CreateSupplierSheet";
import {
  MonthSelector,
  getMonthRange,
  type MonthYear,
} from "@/components/MonthSelector";
import { Pagination, PAGE_SIZE } from "@/components/Pagination";
import { useDebounce } from "@/hooks/useDebounce";
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
import { useCompany } from "@/contexts/CompanyContext";
import { BOLETO_CATEGORY_LABELS } from "@/lib/boletoCategory";
import { maskCpfCnpj } from "@/lib/masks";
import { canGestorAccess } from "@/lib/roles";
import { supabase } from "@/lib/supabase";
import type {
  Boleto,
  Expense,
  ExpenseItem,
  ExpenseType,
} from "@/types/expense";
import type { Product } from "@/types/product";
import type { Supplier } from "@/types/supplier";
import type { PaymentType } from "@/types/expense";
import { Copy, FileText, Pencil, Plus, Trash2, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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

function BoletoLinkedBlock({
  boleto,
  formatCurrency,
  formatDate,
  onVerBoleto,
}: {
  boleto: Boleto;
  formatCurrency: (v: number) => string;
  formatDate: (s: string) => string;
  onVerBoleto: () => void;
}) {
  return (
    <div className="rounded-lg border p-4 space-y-2">
      <p className="font-medium">Boleto vinculado</p>
      <p className="text-sm text-muted-foreground">
        <span className="text-foreground font-medium">
          {BOLETO_CATEGORY_LABELS[boleto.category ?? "outros"]}
        </span>
        {" · "}
        {boleto.description} • {formatCurrency(boleto.amount)} • Venc.{" "}
        {formatDate(boleto.due_date)}
      </p>
      <Button variant="outline" size="sm" onClick={onVerBoleto}>
        Ver boleto
      </Button>
    </div>
  );
}

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
  const [boletos, setBoletos] = useState<Boleto[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [type, setType] = useState<ExpenseType>("nota_fiscal");
  const [supplierId, setSupplierId] = useState<string>("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
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
  const [detailExpense, setDetailExpense] = useState<Expense | null>(null);
  const [detailEditMode, setDetailEditMode] = useState(false);
  const [editType, setEditType] = useState<ExpenseType>("nota_fiscal");
  const [editSupplierId, setEditSupplierId] = useState("");
  const [editInvoiceNumber, setEditInvoiceNumber] = useState("");
  const [editSupplierDocument, setEditSupplierDocument] = useState("");
  const [editSupplierName, setEditSupplierName] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editStatus, setEditStatus] = useState<
    "pending" | "approved" | "rejected"
  >("pending");
  const [editItems, setEditItems] = useState<ExpenseItem[]>([
    { product_name: "", quantity: 1, unit_value: 0 },
  ]);
  const [editSaving, setEditSaving] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [linkItemSheetOpen, setLinkItemSheetOpen] = useState(false);
  const [linkItem, setLinkItem] = useState<{
    id: string;
    product_name: string;
    quantity: number;
    unit_value: number;
  } | null>(null);
  const [linkProductId, setLinkProductId] = useState<string>("");
  const [linkSaving, setLinkSaving] = useState(false);

  const getBoletoForExpense = (expenseId: string) =>
    boletos.find((b) => b.expense_id === expenseId);

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
    if (debouncedSearch.trim()) {
      const term = `%${debouncedSearch.trim()}%`;
      exQuery = exQuery.or(
        `supplier_name.ilike.${term},invoice_number.ilike.${term},display_name.ilike.${term}`,
      );
    }
    const { data: ex, count } = await exQuery
      .range((expensesPage - 1) * PAGE_SIZE, expensesPage * PAGE_SIZE - 1);
    const { data: bo } = await supabase
      .from("boletos")
      .select("*")
      .eq("company_id", currentCompany.id);
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
  }, [currentCompany, period.month, period.year, debouncedSearch, expensesPage]);

  useEffect(() => {
    setExpensesPage(1);
  }, [debouncedSearch, period.month, period.year]);

  useEffect(() => {
    queueMicrotask(() => fetchData());
  }, [fetchData]);

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
        supplier_document:
          ((selectedSupplier?.document ?? supplierDocument) || "").replace(
            /\D/g,
            "",
          ) || null,
        supplier_name: (selectedSupplier?.name ?? supplierName) || null,
        notes: notes || null,
        status: "pending",
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
    setSupplierDocument("");
    setSupplierName("");
    setNotes("");
    setItems([{ product_name: "", quantity: 1, unit_value: 0, product_id: undefined }]);
    setExpenseSheetOpen(false);
    fetchData();
  };

  const unlinkedBoletos = boletos.filter((b) => !b.expense_id);

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

  const openLinkItemSheet = (it: {
    id: string;
    product_name: string;
    quantity: number;
    unit_value: number;
  }) => {
    setLinkItem(it);
    setLinkProductId("");
    setLinkItemSheetOpen(true);
  };

  const handleLinkItemSave = async () => {
    if (!linkItem?.id || !linkProductId) return;
    setLinkSaving(true);
    const { error } = await supabase
      .from("expense_items")
      .update({ product_id: linkProductId, stock_added: false })
      .eq("id", linkItem.id);
    setLinkSaving(false);
    if (error) {
      toast.error("Erro ao vincular");
      return;
    }
    toast.success("Produto vinculado");
    setLinkItemSheetOpen(false);
    setLinkItem(null);
    if (detailExpense?.id) {
      const { data } = await supabase
        .from("expenses")
        .select("*, expense_items (*, products (id, name, current_quantity, min_quantity))")
        .eq("id", detailExpense.id)
        .single();
      if (data) setDetailExpense(data as Expense);
    }
    fetchData();
  };

  const handleDeleteExpense = async () => {
    if (!detailExpense?.id) return;
    setDeleting(true);
    try {
      const items = (detailExpense.expense_items ?? []) as Array<{
        id?: string;
        product_id?: string | null;
        stock_added?: boolean;
        quantity: number;
      }>;
      for (const it of items) {
        if (it.product_id && it.stock_added) {
          const qty = Number(it.quantity);
          await supabase.rpc("adjust_product_stock", {
            p_product_id: it.product_id,
            p_delta: -qty,
            p_type: "out",
            p_reference_type: "expense_item",
            p_reference_id: it.id ?? null,
          });
        }
      }
      const linkedBoleto = getBoletoForExpense(detailExpense.id);
      if (linkedBoleto) {
        await supabase.from("boletos").delete().eq("id", linkedBoleto.id);
      }
      await supabase.from("expenses").delete().eq("id", detailExpense.id);
      setDetailExpense(null);
      setDetailEditMode(false);
      setDeleteDialogOpen(false);
      setBoletoResumo(null);
      toast.success("Despesa excluída");
      fetchData();
    } catch {
      toast.error("Erro ao excluir despesa");
    } finally {
      setDeleting(false);
    }
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

  const startEdit = () => {
    if (!detailExpense) return;
    setEditType(detailExpense.type as ExpenseType);
    setEditSupplierId(detailExpense.supplier_id ?? "");
    setEditInvoiceNumber(detailExpense.invoice_number ?? "");
    setEditSupplierDocument(detailExpense.supplier_document ?? "");
    setEditSupplierName(detailExpense.supplier_name ?? "");
    setEditNotes(detailExpense.notes ?? "");
    setEditStatus(detailExpense.status);
    setEditItems(
      (detailExpense.expense_items?.length ?? 0) > 0
        ? detailExpense.expense_items!.map((it) => ({
            id: it.id,
            product_id: it.product_id ?? undefined,
            stock_added: it.stock_added ?? false,
            product_name: it.product_name ?? "",
            quantity: Number(it.quantity),
            unit_value: Number(it.unit_value),
          }))
        : [{ product_name: "", quantity: 1, unit_value: 0 }],
    );
    setDetailEditMode(true);
  };

  const cancelEdit = () => {
    setDetailEditMode(false);
  };

  const editAddItem = () =>
    setEditItems((prev) => [
      ...prev,
      { product_name: "", quantity: 1, unit_value: 0 },
    ]);
  const editRemoveItem = (i: number) =>
    setEditItems((prev) =>
      prev.length > 1 ? prev.filter((_, ix) => ix !== i) : prev,
    );
  const editUpdateItem = (i: number, f: Partial<ExpenseItem>) =>
    setEditItems((prev) =>
      prev.map((it, ix) => (ix === i ? { ...it, ...f } : it)),
    );

  const editTotalItems = editItems.reduce(
    (s, it) => s + Number(it.quantity) * Number(it.unit_value),
    0,
  );

  const canEditSubmit =
    editItems.every(
      (it) =>
        it.product_name.trim() !== "" &&
        Number(it.quantity) > 0 &&
        Number(it.unit_value) >= 0,
    ) &&
    (editSupplierId !== "" || editSupplierName.trim() !== "") &&
    (editType !== "nota_fiscal" || editInvoiceNumber.trim() !== "");

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detailExpense?.id || !currentCompany?.id || !canEditSubmit) return;
    setEditSaving(true);
    const selectedSupplier = editSupplierId
      ? suppliers.find((s) => s.id === editSupplierId)
      : null;
    const { error: expErr } = await supabase
      .from("expenses")
      .update({
        type: editType,
        supplier_id: editSupplierId || null,
        invoice_number: editType === "nota_fiscal" ? editInvoiceNumber : null,
        supplier_document:
          ((selectedSupplier?.document ?? editSupplierDocument) || "")
            .replace(/\D/g, "")
            .trim() || null,
        supplier_name:
          ((selectedSupplier?.name ?? editSupplierName) || "").trim() || null,
        notes: editNotes || null,
        status: editStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", detailExpense.id);
    if (expErr) {
      console.error(expErr);
      setEditSaving(false);
      return;
    }

    const oldItems = (detailExpense.expense_items ?? []) as Array<{
      id?: string;
      product_id?: string | null;
      stock_added?: boolean;
      quantity: number;
    }>;

    for (const it of oldItems) {
      if (it.product_id && it.stock_added) {
        const qty = Number(it.quantity);
        await supabase.rpc("adjust_product_stock", {
          p_product_id: it.product_id,
          p_delta: -qty,
          p_type: "out",
          p_reference_type: "expense_item",
          p_reference_id: it.id ?? null,
        });
      }
    }

    await supabase
      .from("expense_items")
      .delete()
      .eq("expense_id", detailExpense.id);

    for (const it of editItems) {
      const productId = it.product_id || null;
      const { data: inserted } = await supabase
        .from("expense_items")
        .insert({
          expense_id: detailExpense.id,
          product_name: it.product_name,
          quantity: it.quantity,
          unit_value: it.unit_value,
          product_id: productId,
          stock_added: false,
        })
        .select("id")
        .single();
      void inserted; // Estoque só é atualizado na confirmação do recebimento
    }

    const { data: updated } = await supabase
      .from("expenses")
      .select("*, expense_items (*, products (id, name, current_quantity, min_quantity))")
      .eq("id", detailExpense.id)
      .single();
    setDetailExpense(updated as Expense);
    setDetailEditMode(false);
    setEditSaving(false);
    fetchData();
  };

  return (
    <PageShell className="space-y-8">
      <PageHeader
        title="Despesas"
        description={
          isGestor
            ? "Revisar despesas registradas e vincular boletos"
            : "Registrar despesas e vincular boletos"
        }
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
              <div>
                <Label>Nº da nota</Label>
                <Input
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  placeholder="Ex: 12345"
                />
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
                      <Label className="text-xs">Vincular ao produto (estoque)</Label>
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
                          <SelectItem value="__none__">
                            Não vincular
                          </SelectItem>
                          {products
                            .filter((p) => p.is_active !== false)
                            .map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.name}
                                {p.sku && ` (${p.sku})`} — Estoque: {Number(p.current_quantity).toLocaleString("pt-BR")} {p.unit}
                                {p.last_unit_value != null && p.last_unit_value > 0 && ` • Último: ${Number(p.last_unit_value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground mt-1">
                        Ao vincular, o estoque será atualizado quando o recebimento for confirmado
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
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Todas as despesas
            </CardTitle>
            <CardDescription>
              Clique no ícone de boleto para vincular
            </CardDescription>
          </div>
          <div className="flex items-center gap-4">
            <MonthSelector value={period} onChange={setPeriod} />
            <Button onClick={() => setExpenseSheetOpen(true)} size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Nova despesa
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap gap-3 items-center">
            <Input
              placeholder="Filtrar por fornecedor ou nota..."
              value={expensesSearch}
              onChange={(e) => setExpensesSearch(e.target.value)}
              className="max-w-sm"
            />
          </div>
          {loading ? (
            <p className="text-muted-foreground">Carregando...</p>
          ) : expenses.length === 0 ? (
            <p className="text-muted-foreground">Nenhuma despesa cadastrada</p>
          ) : (
            <div className="space-y-2">
              {expenses.map((exp) => {
                const isHighlight = highlightExpenseId === exp.id;
                const boleto = getBoletoForExpense(exp.id);
                const linked = !!boleto;
                return (
                  <div
                    key={exp.id}
                    id={exp.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setDetailExpense(exp)}
                    onKeyDown={(e) =>
                      e.key === "Enter" && setDetailExpense(exp)
                    }
                    className={`flex items-center justify-between gap-4 rounded-lg border p-4 transition-colors cursor-pointer hover:bg-muted/50 ${
                      isHighlight ? "ring-2 ring-primary" : ""
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">
                        {exp.supplier_name ||
                          TYPE_LABELS[exp.type as keyof typeof TYPE_LABELS] ||
                          "Sem fornecedor"}
                      </p>
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
                          linked
                            ? "Ver resumo do boleto"
                            : "Vincular boleto"
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
              Selecione um boleto para vincular ou cadastre um novo na página de
              Boletos.
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
                    [{BOLETO_CATEGORY_LABELS[b.category ?? "outros"]}]{" "}
                    {b.description} - {formatCurrency(b.amount)} (venc.{" "}
                    {formatDate(b.due_date)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {unlinkedBoletos.length === 0 && (
              <p className="text-sm text-muted-foreground mt-2">
                Não há boletos disponíveis. Cadastre em Boletos.
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
                  navigate("/app/boletos");
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
                <SheetDescription>
                  Dados para pagamento
                </SheetDescription>
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
                      {PAYMENT_TYPE_LABELS[
                        boletoResumo.payment_type ?? "boleto"
                      ]}
                    </Badge>
                    <Badge
                      variant={
                        boletoResumo.status === "paid"
                          ? "default"
                          : "outline"
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
                          <p className="text-sm font-medium">
                            Dados bancários
                          </p>
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
                  onClick={() => navigate("/app/boletos")}
                >
                  Ir para Boletos
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    if (boletoResumo)
                      handleUnlinkBoleto(boletoResumo.id);
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

      <Sheet
        open={!!detailExpense}
        onOpenChange={(o) => {
          if (!o) {
            setDetailExpense(null);
            setDetailEditMode(false);
          }
        }}
      >
        <SheetContent className="overflow-y-auto sm:max-w-lg">
          {detailExpense && (
            <>
              <SheetHeader>
                <div className="flex items-center justify-between pr-8">
                  <SheetTitle>
                    {detailEditMode ? "Editar despesa" : "Dados da despesa"}
                  </SheetTitle>
                  {!detailEditMode && (
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={startEdit}>
                        <Pencil className="h-4 w-4 mr-2" />
                        Editar
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setDeleteDialogOpen(true)}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Excluir
                      </Button>
                    </div>
                  )}
                </div>
                <SheetDescription className="flex flex-wrap items-center gap-2">
                  <span>
                    {detailExpense.supplier_name ||
                      TYPE_LABELS[
                        detailExpense.type as keyof typeof TYPE_LABELS
                      ] ||
                      "Sem fornecedor"}
                  </span>
                  {getBoletoForExpense(detailExpense.id) ? (
                    <Badge
                      variant="default"
                      className="bg-green-600 shrink-0"
                    >
                      Boleto vinculado
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="shrink-0">
                      Sem boleto vinculado
                    </Badge>
                  )}
                </SheetDescription>
              </SheetHeader>
              {detailEditMode ? (
                <form onSubmit={handleUpdate} className="space-y-6 py-6">
                  <div>
                    <Label>Tipo</Label>
                    <Select
                      value={editType}
                      onValueChange={(v) => setEditType(v as ExpenseType)}
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
                      value={editSupplierId}
                      onValueChange={(v) => {
                        setEditSupplierId(v);
                        const s = suppliers.find((x) => x.id === v);
                        if (s) {
                          setEditSupplierName(s.name);
                          setEditSupplierDocument(s.document ?? "");
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
                      </SelectContent>
                    </Select>
                    {!editSupplierId && (
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <div>
                          <Label className="text-xs">Nome (manual)</Label>
                          <Input
                            value={editSupplierName}
                            onChange={(e) =>
                              setEditSupplierName(e.target.value)
                            }
                            placeholder="Ou informe manualmente"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">CNPJ/CPF (manual)</Label>
                          <Input
                            value={editSupplierDocument}
                            onChange={(e) =>
                              setEditSupplierDocument(
                                maskCpfCnpj(e.target.value),
                              )
                            }
                            placeholder="000.000.000-00"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                  {editType === "nota_fiscal" && (
                    <div>
                      <Label>Nº da nota</Label>
                      <Input
                        value={editInvoiceNumber}
                        onChange={(e) => setEditInvoiceNumber(e.target.value)}
                        placeholder="Ex: 12345"
                      />
                    </div>
                  )}
                  {isGestor && (
                    <div>
                      <Label>Status</Label>
                      <Select
                        value={editStatus}
                        onValueChange={(v) =>
                          setEditStatus(
                            v as "pending" | "approved" | "rejected",
                          )
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pending">Pendente</SelectItem>
                          <SelectItem value="approved">Aprovada</SelectItem>
                          <SelectItem value="rejected">Recusada</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div>
                    <div className="flex items-center justify-between">
                      <Label>Itens</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={editAddItem}
                      >
                        <Plus className="h-4 w-4 mr-1" /> Adicionar
                      </Button>
                    </div>
                    <div className="mt-2 space-y-3">
                      {editItems.map((it, i) => (
                        <div key={i} className="space-y-2 rounded-lg border p-3">
                          <div className="flex gap-2 items-end">
                            <div className="flex-1">
                              <Label className="text-xs">Descrição da nota</Label>
                              <Input
                                placeholder="Produto (como vem na nota)"
                                value={it.product_name}
                                onChange={(e) =>
                                  editUpdateItem(i, {
                                    product_name: e.target.value,
                                  })
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
                                  editUpdateItem(i, {
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
                                  editUpdateItem(i, {
                                    unit_value: parseFloat(e.target.value) || 0,
                                  })
                                }
                              />
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => editRemoveItem(i)}
                              disabled={editItems.length === 1}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                          <div>
                            <Label className="text-xs">Vincular ao produto (estoque)</Label>
                            <Select
                              value={it.product_id ?? "__none__"}
                              onValueChange={(v) =>
                                editUpdateItem(i, {
                                  product_id: v === "__none__" ? undefined : v,
                                })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Não vincular" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">
                                  Não vincular
                                </SelectItem>
                                {products
                                  .filter((p) => p.is_active !== false)
                                  .map((p) => (
                                  <SelectItem key={p.id} value={p.id}>
                                    {p.name}
                                    {p.sku && ` (${p.sku})`} — Estoque: {Number(p.current_quantity).toLocaleString("pt-BR")} {p.unit}
                                    {p.last_unit_value != null && p.last_unit_value > 0 && ` • Último: ${Number(p.last_unit_value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`}
                                  </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground mt-1">
                              Ao vincular, o estoque será atualizado quando o recebimento for confirmado
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-sm text-muted-foreground mt-2">
                      Total: {formatCurrency(editTotalItems)}
                    </p>
                  </div>
                  <div>
                    <Label>Observações</Label>
                    <Input
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      placeholder="Opcional"
                    />
                  </div>
                  <SheetFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={cancelEdit}
                      disabled={editSaving}
                    >
                      Cancelar
                    </Button>
                    <Button
                      type="submit"
                      disabled={!canEditSubmit || editSaving}
                    >
                      {editSaving ? "Salvando..." : "Salvar"}
                    </Button>
                  </SheetFooter>
                </form>
              ) : (
                <div className="space-y-6 py-6">
                  <div className="grid gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Tipo:</span>{" "}
                      {detailExpense.type === "nota_fiscal"
                        ? "Nota fiscal"
                        : TYPE_LABELS[
                            detailExpense.type as keyof typeof TYPE_LABELS
                          ]}
                    </div>
                    {detailExpense.supplier_name && (
                      <div>
                        <span className="text-muted-foreground">
                          Fornecedor:
                        </span>{" "}
                        {detailExpense.supplier_name}
                      </div>
                    )}
                    {detailExpense.supplier_document && (
                      <div>
                        <span className="text-muted-foreground">
                          Documento:
                        </span>{" "}
                        {formatDocForDisplay(detailExpense.supplier_document)}
                      </div>
                    )}
                    {detailExpense.invoice_number && (
                      <div>
                        <span className="text-muted-foreground">Nº nota:</span>{" "}
                        {detailExpense.invoice_number}
                      </div>
                    )}
                    <div>
                      <span className="text-muted-foreground">Status:</span>{" "}
                      <Badge
                        variant={
                          detailExpense.status === "approved"
                            ? "default"
                            : detailExpense.status === "rejected"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {STATUS_LABELS[detailExpense.status]}
                      </Badge>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Criada em:</span>{" "}
                      {formatDate(detailExpense.created_at)}
                    </div>
                    {detailExpense.notes && (
                      <div>
                        <span className="text-muted-foreground">
                          Observações:
                        </span>{" "}
                        {detailExpense.notes}
                      </div>
                    )}
                  </div>

                  {(detailExpense.expense_items?.length ?? 0) > 0 && (
                    <div>
                      <p className="font-medium mb-2">Itens</p>
                      <div className="rounded-lg border overflow-hidden">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-muted/50">
                              <th className="text-left p-2 font-medium">
                                Produto
                              </th>
                              <th className="text-left p-2 font-medium">
                                Estoque
                              </th>
                              <th className="text-right p-2 font-medium">
                                Qtd
                              </th>
                              <th className="text-right p-2 font-medium">
                                Valor un.
                              </th>
                              <th className="text-right p-2 font-medium">
                                Subtotal
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {detailExpense.expense_items!.map((it, i) => (
                              <tr key={i} className="border-t">
                                <td className="p-2">
                                  <span>{it.product_name || "—"}</span>
                                  {it.product_id && it.products && (
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                      → {it.products.name}
                                    </p>
                                  )}
                                </td>
                                <td className="p-2">
                                  {it.product_id ? (
                                    <Badge variant="secondary">Vinculado</Badge>
                                  ) : (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        openLinkItemSheet({
                                          id: it.id!,
                                          product_name: it.product_name,
                                          quantity: Number(it.quantity),
                                          unit_value: Number(it.unit_value),
                                        });
                                      }}
                                    >
                                      Vincular
                                    </Button>
                                  )}
                                </td>
                                <td className="p-2 text-right">
                                  {it.quantity}
                                </td>
                                <td className="p-2 text-right">
                                  {formatCurrency(Number(it.unit_value))}
                                </td>
                                <td className="p-2 text-right">
                                  {formatCurrency(
                                    Number(it.quantity) * Number(it.unit_value),
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="text-right font-medium mt-2">
                        Total:{" "}
                        {formatCurrency(
                          detailExpense.expense_items!.reduce(
                            (s, it) =>
                              s + Number(it.quantity) * Number(it.unit_value),
                            0,
                          ),
                        )}
                      </p>
                    </div>
                  )}

                  {getBoletoForExpense(detailExpense.id) ? (
                    <BoletoLinkedBlock
                      boleto={getBoletoForExpense(detailExpense.id)!}
                      formatCurrency={formatCurrency}
                      formatDate={formatDate}
                      onVerBoleto={() =>
                        setBoletoResumo(getBoletoForExpense(detailExpense.id)!)
                      }
                    />
                  ) : null}
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir despesa</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir esta despesa? O recebimento e boleto
              vinculados serão excluídos. Se o recebimento já foi confirmado, as
              quantidades serão deduzidas do estoque.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={deleting}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteExpense}
              disabled={deleting}
            >
              {deleting ? "Excluindo..." : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet
        open={linkItemSheetOpen}
        onOpenChange={(o) => {
          if (!o) {
            setLinkItemSheetOpen(false);
            setLinkItem(null);
          }
        }}
      >
        <SheetContent>
          {linkItem && (
            <>
              <SheetHeader>
                <SheetTitle>Vincular ao produto</SheetTitle>
                <SheetDescription>
                  Vincule este item da nota a um produto do estoque. O estoque será
                  atualizado quando o recebimento for confirmado.
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-4 py-6">
                <div className="rounded-lg border p-3">
                  <p className="font-medium">{linkItem.product_name || "—"}</p>
                  <p className="text-sm text-muted-foreground">
                    {Number(linkItem.quantity).toLocaleString("pt-BR")} un ×{" "}
                    {formatCurrency(linkItem.unit_value)}
                  </p>
                </div>
                <div>
                  <Label>Produto (estoque)</Label>
                  <Select
                    value={linkProductId}
                    onValueChange={setLinkProductId}
                  >
                    <SelectTrigger className="mt-2">
                      <SelectValue placeholder="Selecione o produto" />
                    </SelectTrigger>
                    <SelectContent>
                      {products
                        .filter((p) => p.is_active !== false)
                        .map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                            {p.sku && ` (${p.sku})`} — Estoque:{" "}
                            {Number(p.current_quantity).toLocaleString("pt-BR")}{" "}
                            {p.unit}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <SheetFooter>
                <Button
                  variant="outline"
                  onClick={() => setLinkItemSheetOpen(false)}
                  disabled={linkSaving}
                >
                  Cancelar
                </Button>
                <Button
                  onClick={handleLinkItemSave}
                  disabled={!linkProductId || linkSaving}
                >
                  {linkSaving ? "Vinculando..." : "Vincular"}
                </Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}
