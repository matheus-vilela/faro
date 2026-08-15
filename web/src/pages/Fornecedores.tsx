import { CreateSupplierSheet } from "@/components/CreateSupplierSheet";
import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { PAGE_SIZE, Pagination } from "@/components/Pagination";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCompany } from "@/contexts/CompanyContext";
import { useDebounce } from "@/hooks/useDebounce";
import { maskCpfCnpj, maskPhone } from "@/lib/masks";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import type { Supplier } from "@/types/supplier";
import {
  Check,
  Copy,
  CreditCard,
  Link2,
  Package,
  Pencil,
  Plus,
  Truck,
  UserRound,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const ACCOUNT_TYPES = [
  { value: "conta_corrente", label: "Conta corrente" },
  { value: "poupanca", label: "Poupança" },
];

const PIX_TYPES = [
  { value: "cpf", label: "CPF" },
  { value: "cnpj", label: "CNPJ" },
  { value: "email", label: "E-mail" },
  { value: "phone", label: "Telefone" },
  { value: "random", label: "Chave aleatória" },
];

type SupplierPurchaseProduct = {
  productId: string | null;
  name: string;
  unit: string | null;
  purchaseCount: number;
};

type ExpenseItemPurchaseRow = {
  product_id: string | null;
  product_name: string | null;
  products:
    | { id: string; name: string; unit: string }
    | { id: string; name: string; unit: string }[]
    | null;
};

function expenseItemProduct(
  products: ExpenseItemPurchaseRow["products"],
): { id: string; name: string; unit: string } | null {
  if (!products) return null;
  return Array.isArray(products) ? (products[0] ?? null) : products;
}

function aggregateSupplierPurchaseProducts(
  rows: ExpenseItemPurchaseRow[],
): SupplierPurchaseProduct[] {
  const map = new Map<string, SupplierPurchaseProduct>();
  for (const row of rows) {
    const prod = expenseItemProduct(row.products);
    const name = (prod?.name ?? row.product_name ?? "").trim() || "Item sem nome";
    const key = prod?.id ?? `n:${name.toLowerCase()}`;
    const existing = map.get(key);
    if (existing) {
      existing.purchaseCount += 1;
    } else {
      map.set(key, {
        productId: prod?.id ?? null,
        name,
        unit: prod?.unit ?? null,
        purchaseCount: 1,
      });
    }
  }
  return [...map.values()].sort(
    (a, b) =>
      b.purchaseCount - a.purchaseCount ||
      a.name.localeCompare(b.name, "pt-BR"),
  );
}

function hasSupplierPaymentInfo(s: Supplier) {
  return Boolean(
    s.payment_info && (s.payment_info.bank_name || s.payment_info.pix_key),
  );
}

function FornecedorListRow({
  supplier,
  onOpenDetail,
  onOpenPayment,
  onOpenLink,
}: {
  supplier: Supplier;
  onOpenDetail: () => void;
  onOpenPayment: () => void;
  onOpenLink: () => void;
}) {
  const hasPay = hasSupplierPaymentInfo(supplier);
  const documentLabel = supplier.document?.trim()
    ? maskCpfCnpj(supplier.document)
    : "Sem CPF/CNPJ";
  const contactParts = [
    supplier.email?.trim() || null,
    supplier.phone?.trim() ? maskPhone(supplier.phone) : null,
  ].filter(Boolean);
  const contactLabel =
    contactParts.length > 0 ? contactParts.join(" · ") : "Sem contato";
  const sellerName = supplier.sales_contact_name?.trim() || null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpenDetail}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenDetail();
        }
      }}
      className={cn(
        "group relative border-l-[3px] bg-card outline-none transition-colors",
        "hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        hasPay ? "border-l-emerald-600/80" : "border-l-amber-500/55",
      )}
    >
      <div className="hidden md:grid md:grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_minmax(0,1fr)_auto] md:items-center md:gap-3 md:px-4 md:py-2.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight tracking-tight">
            {supplier.name}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {documentLabel}
          </p>
        </div>
        <p className="min-w-0 truncate text-xs text-muted-foreground">
          {contactLabel}
        </p>
        <p
          className={cn(
            "min-w-0 truncate text-sm",
            sellerName ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {sellerName ?? "—"}
        </p>
        <div
          className="flex items-center justify-end gap-0.5"
          onClick={(e) => e.stopPropagation()}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={
                  hasPay
                    ? "Editar conta de pagamento"
                    : "Inserir conta de pagamento"
                }
                className={cn(
                  "h-8 w-8",
                  hasPay
                    ? "text-emerald-700 hover:text-emerald-800 dark:text-emerald-300"
                    : "text-destructive hover:text-destructive",
                )}
                onClick={onOpenPayment}
              >
                <CreditCard className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {hasPay
                ? "Editar conta de pagamento"
                : "Inserir conta de pagamento"}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Gerar link para o fornecedor atualizar"
                className="h-8 w-8 text-muted-foreground"
                onClick={onOpenLink}
              >
                <Link2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              Gerar link para o fornecedor atualizar
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="flex flex-col gap-2.5 px-3 py-3 md:hidden">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-snug">
              {supplier.name}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {documentLabel}
              <span className="text-muted-foreground/50"> · </span>
              {contactLabel}
            </p>
            {sellerName ? (
              <p className="mt-0.5 truncate text-xs text-foreground">
                Vendedor: {sellerName}
              </p>
            ) : null}
          </div>
        </div>
        <div
          className="flex items-center gap-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={cn(
              "h-8 flex-1 text-xs",
              hasPay
                ? "border-emerald-600/35 text-emerald-800 dark:text-emerald-200"
                : "border-destructive/35 text-destructive",
            )}
            onClick={onOpenPayment}
          >
            <CreditCard className="mr-1.5 h-3.5 w-3.5" />
            Pagamento
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 flex-1 text-xs"
            onClick={onOpenLink}
          >
            <Link2 className="mr-1.5 h-3.5 w-3.5" />
            Link
          </Button>
        </div>
      </div>
    </div>
  );
}

export function Fornecedores() {
  const { currentCompany } = useCompany();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [suppliersCount, setSuppliersCount] = useState(0);
  const [suppliersPage, setSuppliersPage] = useState(1);
  const [suppliersSearch, setSuppliersSearch] = useState("");
  const debouncedSearch = useDebounce(suppliersSearch, 300);
  const [loading, setLoading] = useState(true);
  const [supplierSheetOpen, setSupplierSheetOpen] = useState(false);

  // Sheet conta de pagamento
  const [paymentSheetOpen, setPaymentSheetOpen] = useState(false);
  const [paymentSupplier, setPaymentSupplier] = useState<Supplier | null>(null);
  const [bankName, setBankName] = useState("");
  const [bankCode, setBankCode] = useState("");
  const [agency, setAgency] = useState("");
  const [account, setAccount] = useState("");
  const [accountType, setAccountType] = useState("conta_corrente");
  const [pixKey, setPixKey] = useState("");
  const [pixType, setPixType] = useState("");
  const [paymentSaving, setPaymentSaving] = useState(false);

  // Sheet detalhe do fornecedor
  const [detailSupplier, setDetailSupplier] = useState<Supplier | null>(null);
  const [detailEditMode, setDetailEditMode] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDocument, setEditDocument] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editSalesContactName, setEditSalesContactName] = useState("");
  const [editSalesWhatsapp, setEditSalesWhatsapp] = useState("");
  const [editCommercialManager, setEditCommercialManager] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // Dialog gerar link
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkSupplier, setLinkSupplier] = useState<Supplier | null>(null);
  const [generatedLink, setGeneratedLink] = useState("");
  const [linkCopied, setLinkCopied] = useState(false);
  const [linkGenerating, setLinkGenerating] = useState(false);

  const [supplierPurchaseProducts, setSupplierPurchaseProducts] = useState<
    SupplierPurchaseProduct[]
  >([]);
  const [supplierPurchaseProductsLoading, setSupplierPurchaseProductsLoading] =
    useState(false);

  const fetchSuppliers = useCallback(async () => {
    if (!currentCompany?.id) return;
    setLoading(true);
    let query = supabase
      .from("suppliers")
      .select(
        `
        *,
        supplier_payment_info (*)
      `,
        { count: "exact" },
      )
      .eq("company_id", currentCompany.id)
      .order("name");
    if (debouncedSearch.trim()) {
      const term = `%${debouncedSearch.trim()}%`;
      query = query.or(
        `name.ilike.${term},document.ilike.${term},email.ilike.${term},sales_contact_name.ilike.${term},commercial_manager.ilike.${term}`,
      );
    }
    const { data, count } = await query.range(
      (suppliersPage - 1) * PAGE_SIZE,
      suppliersPage * PAGE_SIZE - 1,
    );
    const list = (data ?? []).map((s: Record<string, unknown>) => ({
      ...s,
      payment_info: Array.isArray(s.supplier_payment_info)
        ? s.supplier_payment_info[0]
        : s.supplier_payment_info,
    }));
    setSuppliers(list as Supplier[]);
    setSuppliersCount(count ?? 0);
    setLoading(false);
  }, [currentCompany, debouncedSearch, suppliersPage]);

  useEffect(() => {
    queueMicrotask(() => setSuppliersPage(1));
  }, [debouncedSearch]);

  useEffect(() => {
    queueMicrotask(() => void fetchSuppliers());
  }, [fetchSuppliers]);

  const openPaymentDialog = (s: Supplier) => {
    setPaymentSupplier(s);
    const pi = s.payment_info;
    setBankName(pi?.bank_name ?? "");
    setBankCode(pi?.bank_code ?? "");
    setAgency(pi?.agency ?? "");
    setAccount(pi?.account ?? "");
    setAccountType(pi?.account_type ?? "conta_corrente");
    setPixKey(pi?.pix_key ?? "");
    setPixType(pi?.pix_type ?? "");
    setPaymentSheetOpen(true);
  };

  const handleSavePayment = async () => {
    if (!paymentSupplier || !currentCompany?.id) return;
    setPaymentSaving(true);
    const pi = paymentSupplier.payment_info;
    if (pi?.id) {
      await supabase
        .from("supplier_payment_info")
        .update({
          bank_name: bankName.trim() || null,
          bank_code: bankCode.trim() || null,
          agency: agency.trim() || null,
          account: account.trim() || null,
          account_type: accountType,
          pix_key: pixKey.trim() || null,
          pix_type: pixType || null,
        })
        .eq("id", pi.id);
    } else {
      await supabase.from("supplier_payment_info").insert({
        company_id: currentCompany.id,
        supplier_id: paymentSupplier.id,
        bank_name: bankName.trim() || null,
        bank_code: bankCode.trim() || null,
        agency: agency.trim() || null,
        account: account.trim() || null,
        account_type: accountType,
        pix_key: pixKey.trim() || null,
        pix_type: pixType || null,
      });
    }
    setPaymentSaving(false);
    setPaymentSheetOpen(false);
    fetchSuppliers();
  };

  const openLinkDialog = async (s: Supplier, invalidatePrevious = false) => {
    if (!currentCompany?.id) return;
    setLinkSupplier(s);
    setGeneratedLink("");
    setLinkDialogOpen(true);
    setLinkGenerating(true);
    if (invalidatePrevious) {
      await supabase
        .from("supplier_update_tokens")
        .update({ used_at: new Date().toISOString() })
        .eq("supplier_id", s.id)
        .is("used_at", null);
    }
    const { data } = await supabase
      .from("supplier_update_tokens")
      .insert({ company_id: currentCompany.id, supplier_id: s.id })
      .select("token")
      .single();
    setLinkGenerating(false);
    if (data?.token) {
      setGeneratedLink(
        `${window.location.origin}/atualizar-pagamento/${data.token}`,
      );
    }
  };

  const handleCopyLink = async () => {
    if (!generatedLink) return;
    await navigator.clipboard.writeText(generatedLink);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  const handleGenerateNewLink = async () => {
    if (!linkSupplier || !currentCompany?.id) return;
    setLinkGenerating(true);
    await supabase
      .from("supplier_update_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("supplier_id", linkSupplier.id)
      .is("used_at", null);
    const { data } = await supabase
      .from("supplier_update_tokens")
      .insert({ company_id: currentCompany.id, supplier_id: linkSupplier.id })
      .select("token")
      .single();
    setLinkGenerating(false);
    if (data?.token) {
      setGeneratedLink(
        `${window.location.origin}/atualizar-pagamento/${data.token}`,
      );
      setLinkCopied(false);
    }
  };

  const fetchSupplierPurchaseProducts = useCallback(
    async (supplierId: string) => {
      if (!currentCompany?.id) return;
      setSupplierPurchaseProductsLoading(true);
      const { data, error } = await supabase
        .from("expense_items")
        .select(
          `
          product_id,
          product_name,
          products ( id, name, unit ),
          expenses!inner ( company_id, supplier_id )
        `,
        )
        .eq("expenses.company_id", currentCompany.id)
        .eq("expenses.supplier_id", supplierId)
        .limit(3000);

      if (error) {
        console.error("[fornecedores] produtos_comprados", error.message);
        setSupplierPurchaseProducts([]);
      } else {
        setSupplierPurchaseProducts(
          aggregateSupplierPurchaseProducts(
            (data ?? []) as ExpenseItemPurchaseRow[],
          ),
        );
      }
      setSupplierPurchaseProductsLoading(false);
    },
    [currentCompany?.id],
  );

  useEffect(() => {
    if (!detailSupplier || detailEditMode) {
      setSupplierPurchaseProducts([]);
      return;
    }
    void fetchSupplierPurchaseProducts(detailSupplier.id);
  }, [
    detailSupplier?.id,
    detailEditMode,
    fetchSupplierPurchaseProducts,
  ]);

  const openDetail = (s: Supplier) => {
    setDetailSupplier(s);
    setDetailEditMode(false);
    setEditName(s.name);
    setEditDocument(s.document ? maskCpfCnpj(s.document) : "");
    setEditEmail(s.email ?? "");
    setEditPhone(s.phone ? maskPhone(s.phone) : "");
    setEditSalesContactName(s.sales_contact_name ?? "");
    setEditSalesWhatsapp(s.sales_whatsapp ? maskPhone(s.sales_whatsapp) : "");
    setEditCommercialManager(s.commercial_manager ?? "");
    setEditNotes(s.notes ?? "");
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detailSupplier) return;
    setEditSaving(true);
    await supabase
      .from("suppliers")
      .update({
        name: editName.trim(),
        document: editDocument.replace(/\D/g, "") || null,
        email: editEmail.trim() || null,
        phone: editPhone.replace(/\D/g, "") || null,
        sales_contact_name: editSalesContactName.trim() || null,
        sales_whatsapp: editSalesWhatsapp.replace(/\D/g, "") || null,
        commercial_manager: editCommercialManager.trim() || null,
        notes: editNotes.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", detailSupplier.id);
    setEditSaving(false);
    setDetailEditMode(false);
    fetchSuppliers();
    setDetailSupplier((prev) =>
      prev
        ? {
            ...prev,
            name: editName.trim(),
            document: editDocument.replace(/\D/g, "") || null,
            email: editEmail.trim() || null,
            phone: editPhone.replace(/\D/g, "") || null,
            sales_contact_name: editSalesContactName.trim() || null,
            sales_whatsapp: editSalesWhatsapp.replace(/\D/g, "") || null,
            commercial_manager: editCommercialManager.trim() || null,
            notes: editNotes.trim() || null,
          }
        : null,
    );
  };

  return (
    <PageShell className="flex min-h-0 flex-1 flex-col gap-4 pb-0">
      <PageHeader
        title="Fornecedores"
        description={
          <span className="hidden sm:inline">
            Cadastre fornecedores e gerencie as informações de pagamento
          </span>
        }
        icon={Truck}
        className="shrink-0"
        action={
          <Button
            type="button"
            onClick={() => setSupplierSheetOpen(true)}
            className="h-10 w-full shrink-0 sm:w-auto"
          >
            <Plus className="h-4 w-4 mr-2" />
            Novo fornecedor
          </Button>
        }
      />

      {currentCompany?.id && (
        <CreateSupplierSheet
          open={supplierSheetOpen}
          onOpenChange={setSupplierSheetOpen}
          companyId={currentCompany.id}
          onSuccess={() => fetchSuppliers()}
        />
      )}

      <div className="flex shrink-0 flex-col gap-3 rounded-xl border bg-card/60 px-3 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4 sm:px-4">
        <Input
          placeholder="Filtrar por nome, documento, e-mail, vendedor ou gerente..."
          value={suppliersSearch}
          onChange={(e) => setSuppliersSearch(e.target.value)}
          className="h-9 min-w-0 flex-1 sm:max-w-xs"
        />
      </div>

      <div className="flex max-h-[calc(100dvh-11rem)] min-h-[min(28rem,calc(100dvh-13rem))] flex-1 flex-col overflow-hidden rounded-xl border bg-card">
        <div className="hidden shrink-0 border-b bg-muted/30 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:grid md:grid-cols-[minmax(0,1.6fr)_minmax(0,1.2fr)_minmax(0,1fr)_auto] md:gap-3">
          <span>Fornecedor</span>
          <span>Contato</span>
          <span>Vendedor</span>
          <span className="text-right pr-1">Ações</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <p className="px-4 py-8 text-sm text-muted-foreground">
              Carregando...
            </p>
          ) : suppliers.length === 0 ? (
            <p className="px-4 py-8 text-sm text-muted-foreground">
              {debouncedSearch.trim()
                ? "Nenhum fornecedor encontrado para este filtro."
                : "Nenhum fornecedor cadastrado."}
            </p>
          ) : (
            <div className="divide-y">
              {suppliers.map((s) => (
                <FornecedorListRow
                  key={s.id}
                  supplier={s}
                  onOpenDetail={() => openDetail(s)}
                  onOpenPayment={() => openPaymentDialog(s)}
                  onOpenLink={() => void openLinkDialog(s)}
                />
              ))}
            </div>
          )}
        </div>

        {!loading && (
          <div className="shrink-0 border-t px-2 py-2 sm:px-4">
            <Pagination
              page={suppliersPage}
              totalCount={suppliersCount}
              onPageChange={setSuppliersPage}
            />
          </div>
        )}
      </div>

      {/* Sheet inserir/editar conta */}
      <Sheet open={paymentSheetOpen} onOpenChange={setPaymentSheetOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Conta de pagamento</SheetTitle>
            <SheetDescription>
              {paymentSupplier?.name} — informe os dados bancários ou PIX
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-4 py-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Label>Banco</Label>
                <Input
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  placeholder="Nome do banco"
                />
              </div>
              <div>
                <Label>Código do banco</Label>
                <Input
                  value={bankCode}
                  onChange={(e) => setBankCode(e.target.value)}
                  placeholder="001"
                />
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Label>Agência</Label>
                <Input
                  value={agency}
                  onChange={(e) => setAgency(e.target.value)}
                  placeholder="0000"
                />
              </div>
              <div>
                <Label>Conta</Label>
                <Input
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  placeholder="00000-0"
                />
              </div>
            </div>
            <div>
              <Label>Tipo de conta</Label>
              <Select value={accountType} onValueChange={setAccountType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACCOUNT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="border-t pt-4">
              <Label className="text-sm font-medium">PIX</Label>
              <div className="flex gap-2 mt-2">
                <div>
                  <Label className="text-xs">Tipo da chave</Label>
                  <Select value={pixType} onValueChange={setPixType}>
                    <SelectTrigger>
                      <SelectValue placeholder="Tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      {PIX_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1">
                  <Label className="text-xs">Chave PIX</Label>
                  <Input
                    value={pixKey}
                    onChange={(e) => setPixKey(e.target.value)}
                    placeholder="Chave PIX"
                  />
                </div>
              </div>
            </div>
          </div>
          <SheetFooter>
            <Button
              variant="outline"
              onClick={() => setPaymentSheetOpen(false)}
            >
              Cancelar
            </Button>
            <Button onClick={handleSavePayment} disabled={paymentSaving}>
              {paymentSaving ? "Salvando..." : "Salvar"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Dialog gerar link */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Link para fornecedor atualizar dados</DialogTitle>
            <DialogDescription>
              Envie este link ao fornecedor {linkSupplier?.name}. O link é
              válido para uma única atualização e expira em 7 dias.
            </DialogDescription>
          </DialogHeader>
          {linkGenerating ? (
            <p className="text-muted-foreground">Gerando link...</p>
          ) : generatedLink ? (
            <div className="space-y-4">
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={generatedLink}
                  className="font-mono text-sm"
                />
                <Button variant="outline" size="icon" onClick={handleCopyLink}>
                  {linkCopied ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <Button
                variant="secondary"
                className="w-full"
                onClick={handleGenerateNewLink}
              >
                Gerar novo link
              </Button>
              <p className="text-xs text-muted-foreground">
                Ao gerar um novo link, o anterior deixa de ser válido.
              </p>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Sheet resumo do fornecedor */}
      <Sheet
        open={!!detailSupplier}
        onOpenChange={(o) => {
          if (!o) {
            setDetailSupplier(null);
            setDetailEditMode(false);
          }
        }}
      >
        <SheetContent className="overflow-y-auto sm:max-w-lg">
          {detailSupplier && (
            <>
              <SheetHeader className="pl-0">
                <div className="flex items-center justify-between pr-8">
                  <SheetTitle className="flex items-center gap-2 text-lg">
                    <Truck className="h-5 w-5" />
                    {detailEditMode
                      ? "Editar fornecedor"
                      : "Dados do fornecedor"}
                  </SheetTitle>
                  {!detailEditMode && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDetailEditMode(true)}
                    >
                      <Pencil className="h-4 w-4 mr-2" />
                      Editar
                    </Button>
                  )}
                </div>
                <SheetDescription>{detailSupplier.name}</SheetDescription>
              </SheetHeader>
              {detailEditMode ? (
                <form onSubmit={handleSaveEdit} className="space-y-4 py-6">
                  <div>
                    <Label>Nome</Label>
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Nome do fornecedor"
                      required
                      className="mt-2"
                    />
                  </div>
                  <div>
                    <Label>CNPJ/CPF</Label>
                    <Input
                      value={editDocument}
                      onChange={(e) =>
                        setEditDocument(maskCpfCnpj(e.target.value))
                      }
                      placeholder="000.000.000-00"
                      className="mt-2"
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label>E-mail</Label>
                      <Input
                        type="email"
                        value={editEmail}
                        onChange={(e) => setEditEmail(e.target.value)}
                        placeholder="email@exemplo.com"
                        className="mt-2"
                      />
                    </div>
                    <div>
                      <Label>Telefone</Label>
                      <Input
                        value={editPhone}
                        onChange={(e) =>
                          setEditPhone(maskPhone(e.target.value))
                        }
                        placeholder="(11) 99999-9999"
                        className="mt-2"
                      />
                    </div>
                  </div>
                  <div className="border-t border-border pt-4 space-y-4">
                    <div className="flex items-center gap-2">
                      <UserRound className="h-4 w-4" />
                      <span className="text-sm font-medium">
                        Contato comercial
                      </span>
                    </div>
                    <div>
                      <Label>Nome do vendedor</Label>
                      <Input
                        value={editSalesContactName}
                        onChange={(e) =>
                          setEditSalesContactName(e.target.value)
                        }
                        placeholder="Nome do representante"
                        className="mt-2"
                      />
                    </div>
                    <div>
                      <Label>WhatsApp (comercial)</Label>
                      <Input
                        value={editSalesWhatsapp}
                        onChange={(e) =>
                          setEditSalesWhatsapp(maskPhone(e.target.value))
                        }
                        placeholder="(11) 99999-9999"
                        className="mt-2"
                      />
                    </div>
                    <div>
                      <Label>Nome do gerente comercial</Label>
                      <Input
                        value={editCommercialManager}
                        onChange={(e) =>
                          setEditCommercialManager(e.target.value)
                        }
                        placeholder="Nome do gerente"
                        className="mt-2"
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Observações</Label>
                    <Input
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      placeholder="Opcional"
                      className="mt-2"
                    />
                  </div>
                  <SheetFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setDetailEditMode(false)}
                      disabled={editSaving}
                    >
                      Cancelar
                    </Button>
                    <Button type="submit" disabled={editSaving}>
                      {editSaving ? "Salvando..." : "Salvar"}
                    </Button>
                  </SheetFooter>
                </form>
              ) : (
                <div className="space-y-6 py-6">
                  <div className="grid gap-4 text-sm">
                    {detailSupplier.document && (
                      <div>
                        <span className="text-muted-foreground">CNPJ/CPF:</span>{" "}
                        {maskCpfCnpj(detailSupplier.document)}
                      </div>
                    )}
                    {detailSupplier.email && (
                      <div>
                        <span className="text-muted-foreground">E-mail:</span>{" "}
                        {detailSupplier.email}
                      </div>
                    )}
                    {detailSupplier.phone && (
                      <div>
                        <span className="text-muted-foreground">Telefone:</span>{" "}
                        {maskPhone(detailSupplier.phone)}
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="font-medium mb-2 flex items-center gap-2 text-sm">
                      <UserRound className="h-4 w-4" />
                      Contato comercial
                    </p>
                    <div className="rounded-lg border p-4 space-y-2 text-sm">
                      <p>
                        <span className="text-muted-foreground">
                          Nome do vendedor:
                        </span>{" "}
                        {detailSupplier.sales_contact_name?.trim() ? (
                          detailSupplier.sales_contact_name
                        ) : (
                          <span className="text-muted-foreground italic">
                            Não informado
                          </span>
                        )}
                      </p>
                      <p>
                        <span className="text-muted-foreground">
                          WhatsApp (comercial):
                        </span>{" "}
                        {detailSupplier.sales_whatsapp?.trim() ? (
                          maskPhone(detailSupplier.sales_whatsapp)
                        ) : (
                          <span className="text-muted-foreground italic">
                            Não informado
                          </span>
                        )}
                      </p>
                      <p>
                        <span className="text-muted-foreground">
                          Nome do gerente comercial:
                        </span>{" "}
                        {detailSupplier.commercial_manager?.trim() ? (
                          detailSupplier.commercial_manager
                        ) : (
                          <span className="text-muted-foreground italic">
                            Não informado
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-4 text-sm">
                    {detailSupplier.notes && (
                      <div>
                        <span className="text-muted-foreground">Obs:</span>{" "}
                        {detailSupplier.notes}
                      </div>
                    )}
                  </div>
                  {detailSupplier.payment_info && (
                    <div>
                      <p className="font-medium mb-2 flex items-center gap-2">
                        <CreditCard className="h-4 w-4" />
                        Conta de pagamento
                      </p>
                      <div className="rounded-lg border p-4 space-y-2 text-sm">
                        {detailSupplier.payment_info.bank_name && (
                          <p>
                            Banco: {detailSupplier.payment_info.bank_name}
                            {detailSupplier.payment_info.bank_code && (
                              <> ({detailSupplier.payment_info.bank_code})</>
                            )}
                          </p>
                        )}
                        {(detailSupplier.payment_info.agency ||
                          detailSupplier.payment_info.account) && (
                          <p>
                            Agência: {detailSupplier.payment_info.agency || "—"}{" "}
                            • Conta:{" "}
                            {detailSupplier.payment_info.account || "—"}
                          </p>
                        )}
                        {detailSupplier.payment_info.pix_key && (
                          <p>PIX: {detailSupplier.payment_info.pix_key}</p>
                        )}
                        {!detailSupplier.payment_info.bank_name &&
                          !detailSupplier.payment_info.pix_key && (
                            <p className="text-muted-foreground">
                              Nenhum dado cadastrado
                            </p>
                          )}
                      </div>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openPaymentDialog(detailSupplier)}
                    >
                      <CreditCard className="h-4 w-4 mr-2" />
                      Conta de pagamento
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openLinkDialog(detailSupplier)}
                    >
                      <Link2 className="h-4 w-4 mr-2" />
                      Gerar link
                    </Button>
                  </div>

                  <div className="border-t border-border pt-4">
                    <p className="mb-2 flex items-center gap-2 text-sm font-medium">
                      <Package className="h-4 w-4 text-muted-foreground" />
                      Produtos que você costuma comprar
                    </p>
                    {supplierPurchaseProductsLoading ? (
                      <p className="text-sm text-muted-foreground">
                        Carregando histórico de compras…
                      </p>
                    ) : supplierPurchaseProducts.length === 0 ? (
                      <p className="text-sm text-muted-foreground italic">
                        Nenhum produto vinculado em despesas deste fornecedor
                        ainda.
                      </p>
                    ) : (
                      <ul className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-border/80 bg-muted/20 p-2">
                        {supplierPurchaseProducts.map((item) => (
                          <li
                            key={
                              item.productId ??
                              `name-${item.name}`
                            }
                            className="flex items-start justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50"
                          >
                            <span className="min-w-0 leading-snug">
                              <span className="font-medium text-foreground">
                                {item.name}
                              </span>
                              {item.unit ? (
                                <span className="ml-1 text-xs text-muted-foreground">
                                  ({item.unit})
                                </span>
                              ) : null}
                            </span>
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                              {item.purchaseCount === 1
                                ? "1× em notas"
                                : `${item.purchaseCount}× em notas`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}
