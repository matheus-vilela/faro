import { ExpenseLauncherInfo } from "@/components/expenses/ExpenseLauncherInfo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { formatBoletoCategoryLabel } from "@/lib/boletoCategory";
import { findExpenseDuplicateId } from "@/lib/expenseDedup";
import { syncCompanyAlerts } from "@/lib/companyAlerts/syncCompanyAlerts";
import { maskCpfCnpj, maskPhone } from "@/lib/masks";
import { canGestorAccess, canOwnerAccess } from "@/lib/roles";
import { supabase } from "@/lib/supabase";
import type { CompanyCategory } from "@/types/category";
import {
  type Boleto,
  type Expense,
  type ExpenseItem,
  type ExpenseType,
  type PaymentType,
} from "@/types/expense";
import type { Product } from "@/types/product";
import type { Supplier } from "@/types/supplier";
import { Copy, Pencil, Plus, Trash2, UserRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  onVerBoleto,
}: {
  boleto: Boleto;
  formatCurrency: (v: number) => string;
  onVerBoleto: () => void;
}) {
  return (
    <div className="rounded-lg border p-4 space-y-2">
      <p className="font-medium">Boleto vinculado</p>
      <p className="text-sm text-muted-foreground">
        {boleto.description} • {formatCurrency(boleto.amount)}
      </p>
      <Button variant="outline" size="sm" onClick={onVerBoleto}>
        Ver boleto
      </Button>
    </div>
  );
}

const EXPENSE_SELECT = `
  *,
  expense_items (*, products (id, name, current_quantity, min_quantity)),
  suppliers (id, name, document, sales_contact_name, sales_whatsapp, commercial_manager)
`;

type ExpenseDetailSheetProps = {
  expenseId: string | null;
  onClose: () => void;
  onRefresh?: () => void;
};

export function ExpenseDetailSheet({
  expenseId,
  onClose,
  onRefresh,
}: ExpenseDetailSheetProps) {
  const { currentCompany, currentRole } = useCompany();
  const navigate = useNavigate();
  const companyId = currentCompany?.id;
  const isGestor = currentRole && canGestorAccess(currentRole);
  const isOwner = currentRole ? canOwnerAccess(currentRole) : false;

  const [detailExpense, setDetailExpense] = useState<Expense | null>(null);
  const [boletos, setBoletos] = useState<Boleto[]>([]);
  const [companyCategories, setCompanyCategories] = useState<CompanyCategory[]>(
    [],
  );
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);

  const [detailEditMode, setDetailEditMode] = useState(false);
  const [editType, setEditType] = useState<ExpenseType>("nota_fiscal");
  const [editSupplierId, setEditSupplierId] = useState("");
  const [editInvoiceNumber, setEditInvoiceNumber] = useState("");
  const [editInvoiceSeries, setEditInvoiceSeries] = useState("");
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
  const [approvingWhatsapp, setApprovingWhatsapp] = useState(false);
  const [linkItemSheetOpen, setLinkItemSheetOpen] = useState(false);
  const [linkItem, setLinkItem] = useState<{
    id: string;
    product_name: string;
    quantity: number;
    unit_value: number;
  } | null>(null);
  const [linkProductId, setLinkProductId] = useState<string>("");
  const [linkSaving, setLinkSaving] = useState(false);
  const [boletoResumo, setBoletoResumo] = useState<Boleto | null>(null);
  const [comprovanteUrl, setComprovanteUrl] = useState<string | null>(null);

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const getBoletoForExpense = (id: string) =>
    boletos.find((b) => b.expense_id === id);

  const categoriesById = useMemo(
    () => new Map(companyCategories.map((c) => [c.id, c])),
    [companyCategories],
  );

  const linkedBoletoForDetail = useMemo(() => {
    if (!detailExpense) return undefined;
    return boletos.find((b) => b.expense_id === detailExpense.id);
  }, [detailExpense, boletos]);

  const loadExpenseData = useCallback(async () => {
    if (!expenseId || !companyId) return;
    const { data: exp, error: expErr } = await supabase
      .from("expenses")
      .select(EXPENSE_SELECT)
      .eq("id", expenseId)
      .single();
    if (expErr || !exp) {
      toast.error("Despesa não encontrada.");
      onCloseRef.current();
      return;
    }
    setDetailExpense(exp as Expense);
    const { data: bo } = await supabase
      .from("boletos")
      .select("*")
      .eq("company_id", companyId)
      .eq("flow_type", "payable");
    setBoletos((bo as Boleto[]) ?? []);
    const { data: catRows } = await supabase
      .from("company_categories")
      .select("*")
      .eq("company_id", companyId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    setCompanyCategories((catRows as CompanyCategory[]) ?? []);
    const { data: sup } = await supabase
      .from("suppliers")
      .select("*")
      .eq("company_id", companyId)
      .order("name");
    const { data: prod } = await supabase
      .from("products")
      .select("*")
      .eq("company_id", companyId)
      .order("name");
    setSuppliers((sup as Supplier[]) ?? []);
    setProducts((prod as Product[]) ?? []);
  }, [expenseId, companyId]);

  useEffect(() => {
    if (!expenseId || !companyId) {
      setDetailExpense(null);
      setDetailEditMode(false);
      setLoading(false);
      return;
    }
    setDetailEditMode(false);
    setLoading(true);
    void loadExpenseData().finally(() => setLoading(false));
  }, [expenseId, companyId, loadExpenseData]);

  useEffect(() => {
    const path = detailExpense?.source_document_path?.trim();
    if (!path) {
      setComprovanteUrl(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.storage
        .from("expense-documents")
        .createSignedUrl(path, 3600);
      if (!cancelled && !error && data?.signedUrl)
        setComprovanteUrl(data.signedUrl);
    })();
    return () => {
      cancelled = true;
    };
  }, [detailExpense?.source_document_path]);

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

  const handleUnlinkBoleto = async (boletoId: string) => {
    const { error } = await supabase
      .from("boletos")
      .update({ expense_id: null })
      .eq("id", boletoId);
    if (error) console.error(error);
    else {
      await loadExpenseData();
      onRefresh?.();
      if (currentCompany?.id) void syncCompanyAlerts(currentCompany.id);
    }
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
        .select(
          "*, expense_items (*, products (id, name, current_quantity, min_quantity))",
        )
        .eq("id", detailExpense.id)
        .single();
      if (data) setDetailExpense(data as Expense);
    }
    onRefresh?.();
  };

  const handleRejectWhatsappExpense = async () => {
    if (!detailExpense?.id || !isOwner) return;
    setApprovingWhatsapp(true);
    const { error } = await supabase
      .from("expenses")
      .update({
        status: "rejected",
        updated_at: new Date().toISOString(),
      })
      .eq("id", detailExpense.id)
      .eq("expense_source", "whatsapp")
      .eq("status", "pending");
    setApprovingWhatsapp(false);
    if (error) {
      toast.error(error.message ?? "Não foi possível recusar");
      return;
    }
    toast.success("Despesa recusada.");
    const { data: updated } = await supabase
      .from("expenses")
      .select(EXPENSE_SELECT)
      .eq("id", detailExpense.id)
      .single();
    if (updated) setDetailExpense(updated as Expense);
    onRefresh?.();
  };

  const handleApproveWhatsappExpense = async () => {
    if (!detailExpense?.id || !isOwner) return;
    setApprovingWhatsapp(true);
    const { data, error } = await supabase.rpc(
      "approve_whatsapp_expense_as_owner",
      { p_expense_id: detailExpense.id },
    );
    setApprovingWhatsapp(false);
    if (error) {
      toast.error(error.message ?? "Não foi possível aprovar");
      return;
    }
    const res = data as { success?: boolean; error?: string };
    if (!res?.success) {
      toast.error(res?.error ?? "Não foi possível aprovar");
      return;
    }
    toast.success("Despesa aprovada. O recebimento foi liberado.");
    const { data: updated } = await supabase
      .from("expenses")
      .select(EXPENSE_SELECT)
      .eq("id", detailExpense.id)
      .single();
    if (updated) setDetailExpense(updated as Expense);
    onRefresh?.();
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
      setDeleteDialogOpen(false);
      setBoletoResumo(null);
      toast.success("Despesa excluída");
      onClose();
      onRefresh?.();
    } catch {
      toast.error("Erro ao excluir despesa");
    } finally {
      setDeleting(false);
    }
  };

  const startEdit = () => {
    if (!detailExpense) return;
    setEditType(detailExpense.type as ExpenseType);
    setEditSupplierId(detailExpense.supplier_id ?? "");
    setEditInvoiceNumber(detailExpense.invoice_number ?? "");
    setEditInvoiceSeries(detailExpense.invoice_series ?? "");
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
    if (!detailExpense?.id || !companyId || !canEditSubmit) return;
    setEditSaving(true);
    const selectedSupplier = editSupplierId
      ? suppliers.find((s) => s.id === editSupplierId)
      : null;
    const supplierDocDigits =
      ((selectedSupplier?.document ?? editSupplierDocument) || "")
        .replace(/\D/g, "")
        .trim() || null;
    const invNum = editInvoiceNumber.trim();
    const invSer = editType === "nota_fiscal" ? editInvoiceSeries.trim() : "";

    const { duplicateId, error: dupErr } = await findExpenseDuplicateId(
      supabase,
      {
        companyId,
        supplierId: editSupplierId || null,
        supplierDocumentDigits: supplierDocDigits,
        invoiceNumber: invNum,
        invoiceSeries: invSer,
        excludeExpenseId: detailExpense.id,
      },
    );
    if (dupErr) {
      console.error(dupErr);
      toast.error("Não foi possível verificar duplicidade.");
      setEditSaving(false);
      return;
    }
    if (duplicateId) {
      toast.error(
        "Já existe uma despesa com o mesmo fornecedor e identificação do documento.",
      );
      setEditSaving(false);
      return;
    }

    const { error: expErr } = await supabase
      .from("expenses")
      .update({
        type: editType,
        supplier_id: editSupplierId || null,
        invoice_number:
          editType === "nota_fiscal"
            ? editInvoiceNumber.trim()
            : editInvoiceNumber.trim() || null,
        invoice_series:
          editType === "nota_fiscal" ? editInvoiceSeries.trim() || null : null,
        supplier_document: supplierDocDigits,
        supplier_name:
          ((selectedSupplier?.name ?? editSupplierName) || "").trim() || null,
        notes: editNotes || null,
        status: editStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", detailExpense.id);
    if (expErr) {
      console.error(expErr);
      if (expErr.code === "23505") {
        toast.error(
          "Já existe uma despesa com o mesmo fornecedor e identificação do documento.",
        );
      } else {
        toast.error(expErr.message ?? "Não foi possível salvar.");
      }
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
      void inserted;
    }

    const { data: updated } = await supabase
      .from("expenses")
      .select(
        "*, expense_items (*, products (id, name, current_quantity, min_quantity))",
      )
      .eq("id", detailExpense.id)
      .single();
    setDetailExpense(updated as Expense);
    setDetailEditMode(false);
    setEditSaving(false);
    onRefresh?.();
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

  const handleSheetOpenChange = (o: boolean) => {
    if (!o) {
      onClose();
      setDetailEditMode(false);
    }
  };

  if (!companyId) return null;

  return (
    <>
      <Sheet open={!!expenseId} onOpenChange={handleSheetOpenChange}>
        <SheetContent className="overflow-y-auto sm:max-w-lg">
          {loading && (
            <p className="text-sm text-muted-foreground py-8">Carregando…</p>
          )}
          {!loading && detailExpense && (
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
                  {linkedBoletoForDetail ? (
                    <Badge variant="default" className="bg-green-600 shrink-0">
                      Boleto vinculado
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="shrink-0">
                      Sem boleto vinculado
                    </Badge>
                  )}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4 border-t border-border pt-4">
                <ExpenseLauncherInfo expenseId={detailExpense.id} />
              </div>
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
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label>Nº da nota / NFC-e</Label>
                        <Input
                          value={editInvoiceNumber}
                          onChange={(e) => setEditInvoiceNumber(e.target.value)}
                          placeholder="Ex: 12345"
                        />
                      </div>
                      <div>
                        <Label>Série</Label>
                        <Input
                          value={editInvoiceSeries}
                          onChange={(e) => setEditInvoiceSeries(e.target.value)}
                          placeholder="Ex: 1"
                        />
                      </div>
                    </div>
                  )}
                  {(editType === "romaneio" || editType === "recibo") && (
                    <div>
                      <Label>Nº do documento (opcional)</Label>
                      <Input
                        value={editInvoiceNumber}
                        onChange={(e) => setEditInvoiceNumber(e.target.value)}
                        placeholder="Mesmo fornecedor + mesmo nº não podem repetir"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Se informado, não é permitido duplicar para o mesmo
                        fornecedor.
                      </p>
                    </div>
                  )}
                  {isGestor &&
                    detailExpense.expense_source === "whatsapp" &&
                    detailExpense.status === "pending" &&
                    !isOwner && (
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
                            <SelectItem value="rejected">Recusar</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground mt-1.5">
                          Só o proprietário pode aprovar. Você pode recusar se o
                          lançamento estiver incorreto.
                        </p>
                      </div>
                    )}
                  {isGestor &&
                    !(
                      detailExpense.expense_source === "whatsapp" &&
                      detailExpense.status === "pending"
                    ) && (
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
                        <div
                          key={i}
                          className="space-y-2 rounded-lg border p-3"
                        >
                          <div className="flex gap-2 items-end">
                            <div className="flex-1">
                              <Label className="text-xs">
                                Descrição da nota
                              </Label>
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
                            <Label className="text-xs">
                              Vincular ao produto (estoque)
                            </Label>
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
                                      {p.sku && ` (${p.sku})`} — Estoque:{" "}
                                      {Number(
                                        p.current_quantity,
                                      ).toLocaleString("pt-BR")}{" "}
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
                    {detailExpense.supplier_id &&
                      (() => {
                        const s = suppliers.find(
                          (x) => x.id === detailExpense.supplier_id,
                        );
                        if (
                          !s ||
                          (!s.sales_contact_name?.trim() &&
                            !s.sales_whatsapp?.trim() &&
                            !s.commercial_manager?.trim())
                        ) {
                          return null;
                        }
                        return (
                          <div className="rounded-lg border border-border/80 p-3 space-y-1.5 text-sm">
                            <p className="font-medium flex items-center gap-2 text-muted-foreground">
                              <UserRound className="h-4 w-4" />
                              Contato comercial (fornecedor)
                            </p>
                            {s.sales_contact_name?.trim() && (
                              <p>
                                <span className="text-muted-foreground">
                                  Vendedor:
                                </span>{" "}
                                {s.sales_contact_name}
                              </p>
                            )}
                            {s.sales_whatsapp?.trim() && (
                              <p>
                                <span className="text-muted-foreground">
                                  WhatsApp:
                                </span>{" "}
                                {maskPhone(s.sales_whatsapp)}
                              </p>
                            )}
                            {s.commercial_manager?.trim() && (
                              <p>
                                <span className="text-muted-foreground">
                                  Nome do gerente comercial:
                                </span>{" "}
                                {s.commercial_manager}
                              </p>
                            )}
                          </div>
                        );
                      })()}
                    {detailExpense.invoice_number && (
                      <div>
                        <span className="text-muted-foreground">
                          {detailExpense.type === "nota_fiscal"
                            ? "Nº nota:"
                            : "Nº documento:"}
                        </span>{" "}
                        {detailExpense.invoice_number}
                        {detailExpense.invoice_series ? (
                          <>
                            {" "}
                            <span className="text-muted-foreground">
                              · série:
                            </span>{" "}
                            {detailExpense.invoice_series}
                          </>
                        ) : null}
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
                      {detailExpense.expense_source === "whatsapp" && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          (WhatsApp)
                        </span>
                      )}
                    </div>
                    <div className="rounded-lg border border-border/80 bg-muted/20 p-3 space-y-2">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Fluxo de caixa e alertas
                      </p>
                      <div>
                        <span className="text-muted-foreground">Categoria:</span>{" "}
                        <span className="text-foreground">
                          {linkedBoletoForDetail
                            ? formatBoletoCategoryLabel(
                                linkedBoletoForDetail,
                                categoriesById,
                              )
                            : "—"}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">
                          Vencimento:
                        </span>{" "}
                        <span className="text-foreground">
                          {linkedBoletoForDetail
                            ? formatDate(linkedBoletoForDetail.due_date)
                            : "—"}
                        </span>
                      </div>
                      {!linkedBoletoForDetail && (
                        <p className="text-xs text-muted-foreground">
                          Categoria e vencimento vêm do boleto vinculado. Use o
                          ícone na lista de despesas para vincular.
                        </p>
                      )}
                    </div>
                    {detailExpense.expense_source === "whatsapp" &&
                      detailExpense.status === "pending" &&
                      isOwner && (
                        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-3 space-y-2">
                          <p className="text-sm">
                            Esta despesa só entra no recebimento e nos alertas
                            depois da sua aprovação.
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              disabled={approvingWhatsapp}
                              onClick={() =>
                                void handleApproveWhatsappExpense()
                              }
                            >
                              {approvingWhatsapp
                                ? "Aprovando…"
                                : "Aprovar despesa"}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={approvingWhatsapp}
                              onClick={() => void handleRejectWhatsappExpense()}
                            >
                              Recusar
                            </Button>
                          </div>
                        </div>
                      )}
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

                  {linkedBoletoForDetail ? (
                    <BoletoLinkedBlock
                      boleto={linkedBoletoForDetail}
                      formatCurrency={formatCurrency}
                      onVerBoleto={() =>
                        setBoletoResumo(linkedBoletoForDetail)
                      }
                    />
                  ) : null}

                  {detailExpense.source_document_path && (
                    <div className="rounded-lg border p-4 space-y-2">
                      <p className="font-medium">Comprovante</p>
                      {!comprovanteUrl ? (
                        <p className="text-sm text-muted-foreground">
                          Carregando visualização…
                        </p>
                      ) : /\.(jpe?g|png|webp|gif)$/i.test(
                          detailExpense.source_document_path,
                        ) ? (
                        <a
                          href={comprovanteUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block"
                        >
                          <img
                            src={comprovanteUrl}
                            alt="Comprovante da despesa"
                            className="max-h-80 w-full rounded-md border object-contain bg-muted/30"
                          />
                        </a>
                      ) : (
                        <a
                          href={comprovanteUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-primary underline"
                        >
                          Abrir arquivo anexo (PDF ou XML)
                        </a>
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>

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
                    if (!boletoResumo) return;
                    const id = boletoResumo.id;
                    setBoletoResumo(null);
                    void handleUnlinkBoleto(id);
                  }}
                >
                  Desvincular boleto
                </Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir despesa</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir esta despesa? O recebimento e
              boleto vinculados serão excluídos. Se o recebimento já foi
              confirmado, as quantidades serão deduzidas do estoque.
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
                  Vincule este item da nota a um produto do estoque. O estoque
                  será atualizado quando o recebimento for confirmado.
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
    </>
  );
}
