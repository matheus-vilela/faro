import { ExpenseFinancialReconciliationPanel } from "@/components/expenses/ExpenseFinancialReconciliationPanel";
import { ExpenseRecordedDivergenceBanner } from "@/components/expenses/ExpenseImportAttentionPanel";
import { ExpenseLauncherInfo } from "@/components/expenses/ExpenseLauncherInfo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
  productSearchOption,
  SearchSelect,
  supplierSearchOption,
} from "@/components/ui/search-select";
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
import { useCompany, useHasPermission } from "@/contexts/CompanyContext";
import { syncCompanyAlerts } from "@/lib/companyAlerts/syncCompanyAlerts";
import { findExpenseDuplicateId } from "@/lib/expenseDedup";
import { maskCpfCnpj, maskPhone } from "@/lib/masks";
import { stripPackSizeFromLabel } from "@/lib/productImport/packSizeFromLabel";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import {
  type Boleto,
  type Expense,
  type ExpenseItem,
  type ExpenseType,
  type PaymentType,
} from "@/types/expense";
import type { Product } from "@/types/product";
import type { Supplier } from "@/types/supplier";
import {
  ChevronDown,
  Copy,
  Pencil,
  Plus,
  Trash2,
  UserRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

function formatDocForDisplay(doc: string | null): string {
  if (!doc || !doc.replace(/\D/g, "")) return "";
  return maskCpfCnpj(doc);
}

function expenseChaveNfe(
  json: Record<string, unknown> | null | undefined,
): string {
  if (!json || typeof json !== "object") return "";
  return String(json.chave_nfe ?? "").trim();
}

const TYPE_LABELS: Record<Exclude<ExpenseType, "nota_fiscal">, string> = {
  romaneio: "Romaneio",
  recibo: "Recibo",
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
    <div
      className="cursor-pointer rounded-xl border-2 border-green-300/60 bg-green-100/10 p-4 shadow-sm transition-colors hover:bg-green-600/15"
      role="button"
      tabIndex={0}
      onClick={onVerBoleto}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onVerBoleto();
        }
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-green-800 dark:text-green-300">
            Boleto vinculado
          </p>
          <p className="mt-1 truncate text-sm font-medium text-foreground">
            {boleto.description}
          </p>
          <p className="mt-2 text-2xl font-bold tabular-nums text-green-700 dark:text-green-400">
            {formatCurrency(boleto.amount)}
          </p>
        </div>
        <Badge className="shrink-0 bg-green-600 hover:bg-green-700">
          Ver detalhes
        </Badge>
      </div>
    </div>
  );
}

function BoletoUnlinkedBlock() {
  return (
    <div className="rounded-xl border-2 border-dashed border-border bg-muted/50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Pagamento
      </p>
      <p className="mt-1 text-lg font-semibold text-foreground">
        Sem boleto vinculado
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Nenhum boleto associado a esta nota fiscal.
      </p>
    </div>
  );
}

const EXPENSE_SELECT = `
  *,
  expense_items (*, products (id, name, current_quantity, min_quantity)),
  suppliers (id, name, document, sales_contact_name, sales_whatsapp, commercial_manager)
`;

type ExpenseItemStockRow = {
  id?: string;
  product_id?: string | null;
  stock_added?: boolean;
  quantity: number;
  stock_quantity?: number | null;
  unit_value?: number;
};

function expenseItemStockQty(it: ExpenseItemStockRow): number {
  const sq = it.stock_quantity;
  if (sq != null && Number(sq) > 0) return Number(sq);
  return Number(it.quantity);
}

async function reverseExpenseItemStock(it: ExpenseItemStockRow): Promise<void> {
  if (!it.product_id) return;
  await supabase.rpc("adjust_product_stock", {
    p_product_id: it.product_id,
    p_delta: -expenseItemStockQty(it),
    p_type: "out",
    p_reference_type: "expense_item",
    p_reference_id: it.id ?? null,
  });
}

async function applyExpenseItemStockIn(it: ExpenseItemStockRow): Promise<void> {
  if (!it.product_id) return;
  const delta = expenseItemStockQty(it);
  if (delta <= 0) return;
  await supabase.rpc("adjust_product_stock", {
    p_product_id: it.product_id,
    p_delta: delta,
    p_type: "in",
    p_reference_type: "expense_item",
    p_reference_id: it.id ?? null,
    p_unit_value:
      it.unit_value != null && Number(it.unit_value) >= 0
        ? Number(it.unit_value)
        : null,
  });
}

/** Transfere estoque entre produtos ou ajusta quantidade só na linha alterada. */
async function syncExpenseItemStockOnEdit(
  old: ExpenseItemStockRow,
  it: {
    id?: string;
    product_id?: string | null;
    quantity: number;
    unit_value: number;
    stock_quantity?: number | null;
  },
): Promise<boolean> {
  const oldPid = old.product_id ?? null;
  const newPid = it.product_id || null;
  const productChanged = oldPid !== newPid;
  const qtyChanged = Number(old.quantity) !== Number(it.quantity);
  const hadStock = !!(old.product_id && old.stock_added);

  if (!hadStock) {
    return !!(old.stock_added && !productChanged && !qtyChanged);
  }

  if (!productChanged && !qtyChanged) {
    return true;
  }

  await reverseExpenseItemStock(old);

  if (!newPid) {
    return false;
  }

  await applyExpenseItemStockIn({
    id: it.id,
    product_id: newPid,
    quantity: it.quantity,
    stock_quantity: qtyChanged ? undefined : old.stock_quantity,
    unit_value: it.unit_value,
  });
  return true;
}

type ExpenseDetailSheetProps = {
  expenseId: string | null;
  onClose: () => void;
  onRefresh?: () => void;
  /** Empilha acima de outros sheets (ex.: resumo de boleto no fluxo). */
  elevated?: boolean;
};

export function ExpenseDetailSheet({
  expenseId,
  onClose,
  onRefresh,
  elevated = false,
}: ExpenseDetailSheetProps) {
  const { currentCompany, isCompanyOwner } = useCompany();
  const navigate = useNavigate();
  const companyId = currentCompany?.id;
  const canEditDespesas = useHasPermission("despesas");
  const isOwner = isCompanyOwner;

  const [detailExpense, setDetailExpense] = useState<Expense | null>(null);
  const [boletos, setBoletos] = useState<Boleto[]>([]);
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
  const [validationDetailsOpen, setValidationDetailsOpen] = useState(false);
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
  const supportDataLoadedCompanyRef = useRef<string | null>(null);

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    setValidationDetailsOpen(false);
  }, [detailExpense?.id]);

  const getBoletoForExpense = (id: string) =>
    boletos.find((b) => b.expense_id === id);

  const linkedBoletoForDetail = useMemo(() => {
    if (!detailExpense) return undefined;
    return boletos.find((b) => b.expense_id === detailExpense.id);
  }, [detailExpense, boletos]);

  const detailLineSum = useMemo(() => {
    if (!detailExpense?.expense_items?.length) return 0;
    return detailExpense.expense_items.reduce(
      (s, it) => s + Number(it.quantity) * Number(it.unit_value),
      0,
    );
  }, [detailExpense?.expense_items]);

  const detailUnlinkedProductRows = useMemo(() => {
    if (!detailExpense?.expense_items?.length) return 0;
    return detailExpense.expense_items.filter((it) => !it.product_id).length;
  }, [detailExpense?.expense_items]);

  const supplierSelectOptions = useMemo(
    () => suppliers.map(supplierSearchOption),
    [suppliers],
  );

  const productSelectOptions = useMemo(
    () =>
      products
        .filter((p) => p.is_active !== false)
        .map(productSearchOption),
    [products],
  );

  const loadExpenseData = useCallback(async () => {
    if (!expenseId || !companyId) return;
    const { data: exp, error: expErr } = await supabase
      .from("expenses")
      .select(EXPENSE_SELECT)
      .eq("id", expenseId)
      .single();
    if (expErr || !exp) {
      toast.error("Nota fiscal não encontrada.");
      onCloseRef.current();
      return;
    }
    setDetailExpense(exp as Expense);
    const shouldLoadSupportData =
      supportDataLoadedCompanyRef.current !== companyId;
    if (shouldLoadSupportData) {
      const [{ data: bo }, { data: sup }, { data: prod }] = await Promise.all([
        supabase
          .from("boletos")
          .select("*")
          .eq("company_id", companyId)
          .eq("flow_type", "payable"),
        supabase
          .from("suppliers")
          .select("*")
          .eq("company_id", companyId)
          .order("name"),
        supabase
          .from("products")
          .select("*")
          .eq("company_id", companyId)
          .order("name"),
      ]);
      setBoletos((bo as Boleto[]) ?? []);
      setSuppliers((sup as Supplier[]) ?? []);
      setProducts((prod as Product[]) ?? []);
      supportDataLoadedCompanyRef.current = companyId;
    } else {
      const { data: bo } = await supabase
        .from("boletos")
        .select("*")
        .eq("company_id", companyId)
        .eq("flow_type", "payable");
      setBoletos((bo as Boleto[]) ?? []);
    }
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
    const oldItem = detailExpense?.expense_items?.find(
      (i) => i.id === linkItem.id,
    );
    const oldPid = oldItem?.product_id ?? null;
    const hadStock = !!(oldPid && oldItem?.stock_added);

    if (hadStock && oldPid !== linkProductId) {
      await reverseExpenseItemStock({
        id: linkItem.id,
        product_id: oldPid,
        stock_added: true,
        quantity: Number(oldItem!.quantity),
        stock_quantity: oldItem!.stock_quantity ?? undefined,
        unit_value: Number(oldItem!.unit_value),
      });
      await applyExpenseItemStockIn({
        id: linkItem.id,
        product_id: linkProductId,
        quantity: Number(linkItem.quantity),
        stock_quantity: oldItem!.stock_quantity ?? undefined,
        unit_value: Number(linkItem.unit_value),
      });
    }

    const { error } = await supabase
      .from("expense_items")
      .update({
        product_id: linkProductId,
        stock_added: hadStock,
      })
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
    toast.success("Nota fiscal recusada.");
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
    toast.success("Nota fiscal aprovada. O recebimento foi liberado.");
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
      toast.success("Nota fiscal excluída");
      onClose();
      onRefresh?.();
    } catch {
      toast.error("Erro ao excluir nota fiscal");
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
            stock_quantity: it.stock_quantity ?? undefined,
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

  /** NF-e: exige nº da nota ao criar ou ao mudar de outro tipo para NF; se a despesa já era NF sem número (import/WhatsApp), permite salvar outras alterações. */
  const notaFiscalInvoiceOk =
    editType !== "nota_fiscal" ||
    editInvoiceNumber.trim() !== "" ||
    (!!detailExpense &&
      detailExpense.type === "nota_fiscal" &&
      editType === "nota_fiscal" &&
      !detailExpense.invoice_number?.trim());

  const canEditSubmit =
    editItems.every(
      (it) =>
        it.product_name.trim() !== "" &&
        Number(it.quantity) > 0 &&
        Number(it.unit_value) >= 0,
    ) &&
    (editSupplierId !== "" || editSupplierName.trim() !== "") &&
    notaFiscalInvoiceOk;

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
        "Já existe uma nota fiscal com o mesmo fornecedor e identificação do documento.",
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
          "Já existe uma nota fiscal com o mesmo fornecedor e identificação do documento.",
        );
      } else {
        toast.error(expErr.message ?? "Não foi possível salvar.");
      }
      setEditSaving(false);
      return;
    }

    const oldItems: ExpenseItemStockRow[] = (
      detailExpense.expense_items ?? []
    ).map((row) => ({
      id: row.id,
      product_id: row.product_id,
      stock_added: row.stock_added,
      quantity: Number(row.quantity),
      stock_quantity: row.stock_quantity,
      unit_value: Number(row.unit_value),
    }));
    const oldById = new Map(
      oldItems.filter((it) => it.id).map((it) => [it.id as string, it]),
    );
    const keptEditIds = new Set<string>();

    for (const it of editItems) {
      const productId = it.product_id || null;

      if (it.id && oldById.has(it.id)) {
        keptEditIds.add(it.id);
        const old = oldById.get(it.id)!;
        const stockAdded = await syncExpenseItemStockOnEdit(old, {
          id: it.id,
          product_id: productId,
          quantity: it.quantity,
          unit_value: it.unit_value,
          stock_quantity: it.stock_quantity,
        });

        const { error: itemErr } = await supabase
          .from("expense_items")
          .update({
            product_name: it.product_name,
            quantity: it.quantity,
            unit_value: it.unit_value,
            product_id: productId,
            stock_added: stockAdded,
          })
          .eq("id", it.id);
        if (itemErr) {
          console.error(itemErr);
          toast.error(itemErr.message ?? "Não foi possível atualizar um item.");
          setEditSaving(false);
          return;
        }
        continue;
      }

      const { error: insErr } = await supabase.from("expense_items").insert({
        company_id: detailExpense.company_id,
        expense_id: detailExpense.id,
        product_name: it.product_name,
        quantity: it.quantity,
        unit_value: it.unit_value,
        product_id: productId,
        stock_added: false,
      });
      if (insErr) {
        console.error(insErr);
        toast.error(insErr.message ?? "Não foi possível adicionar um item.");
        setEditSaving(false);
        return;
      }
    }

    for (const old of oldItems) {
      if (!old.id || keptEditIds.has(old.id)) continue;
      if (old.product_id && old.stock_added) {
        await reverseExpenseItemStock(old);
      }
      await supabase.from("expense_items").delete().eq("id", old.id);
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
    toast.success("Nota fiscal atualizada.");
    onClose();
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
        <SheetContent
          className={cn("overflow-y-auto sm:max-w-xl", elevated && "z-[70]")}
          overlayClassName={elevated ? "z-[70]" : undefined}
        >
          {loading && (
            <p className="text-sm text-muted-foreground py-8">Carregando…</p>
          )}
          {!loading && detailExpense && (
            <>
              <SheetHeader>
                <div className="flex items-center justify-between pr-8">
                  <SheetTitle>
                    {detailEditMode ? "Editar nota fiscal" : "Dados da nota fiscal"}
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
                {!detailEditMode && (
                  <SheetDescription className="flex flex-wrap items-center gap-2">
                    <span>
                      {detailExpense.display_name?.trim() ||
                        detailExpense.supplier_name ||
                        TYPE_LABELS[
                          detailExpense.type as keyof typeof TYPE_LABELS
                        ] ||
                        "Sem fornecedor"}
                    </span>
                    {detailExpense.parent_expense_id ? (
                      <Badge variant="secondary" className="shrink-0">
                        Exceção de série
                      </Badge>
                    ) : null}
                    {(detailExpense.series_type === "recurring" ||
                      detailExpense.series_type === "installment") &&
                    !detailExpense.parent_expense_id ? (
                      <Badge variant="outline" className="shrink-0">
                        Série ·{" "}
                        {detailExpense.series_type === "recurring"
                          ? "recorrente"
                          : "parcelada"}
                      </Badge>
                    ) : null}
                    {linkedBoletoForDetail ? (
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
                )}
              </SheetHeader>
              {!detailEditMode && (
                <div className="mt-4 space-y-1 border-t border-border pt-4">
                  <ExpenseLauncherInfo expenseId={detailExpense.id} />
                  <p className="text-sm text-muted-foreground">
                    Cadastrada em {formatDate(detailExpense.created_at)}
                  </p>
                </div>
              )}
              {detailExpense.parent_expense_id && !detailEditMode ? (
                <p className="mt-3 rounded-md border border-sky-600/20 bg-sky-500/5 px-3 py-2 text-xs text-muted-foreground">
                  Exceção materializada de um mês da série. Alterações aqui não
                  mudam a projeção dos demais meses.
                </p>
              ) : null}
              {(detailExpense.series_type === "recurring" ||
                detailExpense.series_type === "installment") &&
              !detailExpense.parent_expense_id &&
              !detailEditMode ? (
                <p className="mt-3 rounded-md border border-amber-600/25 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
                  Esta é a nota fiscal principal da série. Excluí-la remove toda a
                  recorrência/parcelamento e exceções vinculadas. Gerencie
                  ocorrências futuras em Contas a pagar.
                </p>
              ) : null}
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
                    <SearchSelect
                      value={editSupplierId}
                      onValueChange={(v) => {
                        setEditSupplierId(v);
                        const s = suppliers.find((x) => x.id === v);
                        if (s) {
                          setEditSupplierName(s.name);
                          setEditSupplierDocument(s.document ?? "");
                        }
                      }}
                      options={supplierSelectOptions}
                      placeholder="Selecione o fornecedor"
                      searchPlaceholder="Buscar fornecedor…"
                      emptyMessage="Nenhum fornecedor encontrado."
                    />
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
                  {canEditDespesas &&
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
                  {canEditDespesas &&
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
                            <SearchSelect
                              value={it.product_id ?? "__none__"}
                              onValueChange={(v) =>
                                editUpdateItem(i, {
                                  product_id: v === "__none__" ? undefined : v,
                                })
                              }
                              options={productSelectOptions}
                              leadingOptions={[
                                {
                                  value: "__none__",
                                  label: "Não vincular",
                                },
                              ]}
                              placeholder="Não vincular"
                              searchPlaceholder="Buscar produto…"
                              emptyMessage="Nenhum produto encontrado."
                            />
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
                <div className="space-y-4 pb-6 pt-4">
                  {(() => {
                    const supplierRecord = detailExpense.supplier_id
                      ? suppliers.find(
                          (x) => x.id === detailExpense.supplier_id,
                        )
                      : undefined;
                    const supplierLabel =
                      detailExpense.supplier_name?.trim() ||
                      supplierRecord?.name?.trim() ||
                      "Sem fornecedor";
                    const chaveNfe = expenseChaveNfe(
                      detailExpense.financial_reconciliation_json,
                    );
                    return (
                      <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                        <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                          Fornecedor
                        </p>
                        <p className="mt-1 text-xl font-semibold leading-tight text-foreground">
                          {supplierLabel}
                        </p>
                        {detailExpense.supplier_document ? (
                          <p className="mt-1 text-sm text-muted-foreground">
                            {formatDocForDisplay(
                              detailExpense.supplier_document,
                            )}
                          </p>
                        ) : null}
                        {detailExpense.invoice_number || chaveNfe ? (
                          <div className="mt-4 border-t border-border/80 pt-4">
                            <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                              {detailExpense.type === "nota_fiscal"
                                ? "Nota fiscal"
                                : "Documento"}
                            </p>
                            {detailExpense.invoice_number ? (
                              <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
                                Nº {detailExpense.invoice_number}
                                {detailExpense.invoice_series ? (
                                  <span className="font-medium text-muted-foreground">
                                    {" "}
                                    · Série {detailExpense.invoice_series}
                                  </span>
                                ) : null}
                              </p>
                            ) : null}
                            {chaveNfe ? (
                              <div className="mt-3">
                                <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                                  Chave NF-e
                                </p>
                                <div className="mt-1 flex items-start gap-2">
                                  <p className="min-w-0 flex-1 break-all font-mono text-xs leading-relaxed text-foreground">
                                    {chaveNfe}
                                  </p>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-8 shrink-0 px-2"
                                    onClick={() => {
                                      void navigator.clipboard.writeText(
                                        chaveNfe,
                                      );
                                      toast.success("Chave copiada.");
                                    }}
                                  >
                                    <Copy className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })()}

                  {(detailExpense.type === "nota_fiscal" ||
                    detailExpense.financial_reconciliation_json) && (
                    <Collapsible
                      open={validationDetailsOpen}
                      onOpenChange={setValidationDetailsOpen}
                    >
                      <CollapsibleTrigger asChild>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted/40"
                        >
                          <span>Impostos e totais</span>
                          <ChevronDown
                            className={cn(
                              "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                              validationDetailsOpen && "rotate-180",
                            )}
                          />
                        </button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="rounded-b-lg border border-t-0 border-border bg-card px-4 pb-4 pt-3">
                        <ExpenseFinancialReconciliationPanel
                          data={
                            detailExpense.financial_reconciliation_json as
                              | Record<string, unknown>
                              | null
                              | undefined
                          }
                          formatCurrency={formatCurrency}
                        />
                        {!detailExpense.financial_reconciliation_json && (
                          <p className="text-sm text-muted-foreground">
                            Sem dados de impostos e totais para esta nota fiscal.
                          </p>
                        )}
                      </CollapsibleContent>
                    </Collapsible>
                  )}

                  {linkedBoletoForDetail ? (
                    <BoletoLinkedBlock
                      boleto={linkedBoletoForDetail}
                      formatCurrency={formatCurrency}
                      onVerBoleto={() => setBoletoResumo(linkedBoletoForDetail)}
                    />
                  ) : (
                    <BoletoUnlinkedBlock />
                  )}

                  <ExpenseRecordedDivergenceBanner
                    documentTotal={detailExpense.document_total}
                    sumLines={detailLineSum}
                    financialReconciliationJson={
                      detailExpense.financial_reconciliation_json ?? null
                    }
                    divergenceReason={detailExpense.divergence_reason}
                    unlinkedProductRowCount={detailUnlinkedProductRows}
                  />

                  {(detailExpense.expense_items?.length ?? 0) > 0 && (
                    <div>
                      <p className="mb-2 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                        Itens da nota fiscal
                      </p>
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
                            {detailExpense.expense_items!.map((it, i) => {
                              const rawLineName = it.product_name || "";
                              const strippedLine =
                                stripPackSizeFromLabel(rawLineName).trim() ||
                                rawLineName;
                              const catalogName = it.products?.name?.trim();
                              const primary =
                                catalogName ||
                                strippedLine ||
                                rawLineName ||
                                "—";
                              return (
                                <tr key={i} className="border-t">
                                  <td className="p-2">
                                    <span>{primary}</span>
                                    {it.metadata_json?.product_merge ? (
                                      <Badge
                                        variant="outline"
                                        className="mt-1.5 text-xs font-normal"
                                      >
                                        Unificado de{" "}
                                        {
                                          it.metadata_json.product_merge
                                            .from_product_name
                                        }
                                      </Badge>
                                    ) : null}
                                    {catalogName &&
                                      (strippedLine !== catalogName ||
                                        rawLineName !== catalogName) && (
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                          Nota: {strippedLine || rawLineName}
                                        </p>
                                      )}
                                  </td>
                                  <td className="p-2">
                                    {it.product_id ? (
                                      <Badge variant="secondary">
                                        Vinculado
                                      </Badge>
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
                                      Number(it.quantity) *
                                        Number(it.unit_value),
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {detailExpense.expense_source === "whatsapp" &&
                    detailExpense.status === "pending" &&
                    isOwner && (
                      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-3 space-y-2">
                        <p className="text-sm">
                          Esta nota fiscal só entra no recebimento e nos alertas
                          depois da sua aprovação.
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            disabled={approvingWhatsapp}
                            onClick={() => void handleApproveWhatsappExpense()}
                          >
                            {approvingWhatsapp
                              ? "Aprovando…"
                              : "Aprovar nota fiscal"}
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
                            Contato comercial
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
                                Gerente:
                              </span>{" "}
                              {s.commercial_manager}
                            </p>
                          )}
                        </div>
                      );
                    })()}

                  {detailExpense.notes ? (
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">
                        Observações:
                      </span>{" "}
                      {detailExpense.notes}
                    </p>
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
                            alt="Comprovante da nota fiscal"
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
        <SheetContent
          className={cn("sm:max-w-md", elevated && "z-[80]")}
          overlayClassName={elevated ? "z-[80]" : undefined}
        >
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
                  onClick={() => navigate("/app/contas-a-pagar")}
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
            <DialogTitle>Excluir nota fiscal</DialogTitle>
            <DialogDescription>
              {detailExpense &&
              (detailExpense.series_type === "recurring" ||
                detailExpense.series_type === "installment") &&
              !detailExpense.parent_expense_id ? (
                <>
                  Esta é a nota fiscal principal da série. Ao excluir, toda a
                  recorrência ou parcelamento será removida, incluindo exceções
                  materializadas (filhas) e boletos vinculados.
                </>
              ) : (
                <>
                  Tem certeza que deseja excluir esta nota fiscal? O recebimento e
                  boleto vinculados serão excluídos. Se o recebimento já foi
                  confirmado, as quantidades serão deduzidas do estoque.
                </>
              )}
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
                  <SearchSelect
                    value={linkProductId}
                    onValueChange={setLinkProductId}
                    options={productSelectOptions}
                    placeholder="Selecione o produto"
                    searchPlaceholder="Buscar produto…"
                    emptyMessage="Nenhum produto encontrado."
                    triggerClassName="mt-2"
                  />
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
