import { BoletoCategoryPicker } from "@/components/BoletoCategoryPicker";
import { BoletoCategoryRateioFields } from "@/components/BoletoCategoryRateioFields";
import { CreateSupplierSheet } from "@/components/CreateSupplierSheet";
import { ExpenseItemsInlineTable } from "@/components/expenses/ExpenseItemsInlineTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
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
import { syncCompanyAlerts } from "@/lib/companyAlerts/syncCompanyAlerts";
import {
  createReciboExpense,
  draftLinesFromExpenseItems,
  initialRateioLines,
  isCategoryRateioStubItems,
  isMerchandiseExpenseForRateio,
  primaryCategoryIdFromRateio,
  replaceExpenseItemsForRateio,
  scaleRateioLines,
  validateRateioDraft,
  type RateioDraftLine,
} from "@/lib/boletoCategoryRateio";
import { maskCpfCnpj, maskPhone } from "@/lib/masks";
import { supabase } from "@/lib/supabase";
import type { CompanyCategory } from "@/types/category";
import type { Boleto, ExpenseItem, ExpenseType, PaymentType } from "@/types/expense";
import { isBoletoTransfer } from "@/types/expense";
import type { Product } from "@/types/product";
import type { Supplier } from "@/types/supplier";
import { Pencil } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  boleto: "Boleto",
  pix: "PIX",
  ted: "TED",
};

const PIX_KEY_TYPES = [
  { value: "cpf", label: "CPF" },
  { value: "cnpj", label: "CNPJ" },
  { value: "email", label: "E-mail" },
  { value: "phone", label: "Telefone" },
  { value: "random", label: "Chave aleatória" },
];

const ACCOUNT_TYPES = [
  { value: "conta_corrente", label: "Conta corrente" },
  { value: "poupanca", label: "Poupança" },
];

function mapSupplierRow(
  row: Supplier & {
    supplier_payment_info?:
      | Supplier["payment_info"]
      | Supplier["payment_info"][];
  },
): Supplier {
  const paymentInfo = Array.isArray(row.supplier_payment_info)
    ? row.supplier_payment_info[0]
    : row.supplier_payment_info;
  return {
    ...row,
    payment_info: paymentInfo ?? null,
  };
}

function displayPixKey(type: string, key: string): string {
  if (type === "cpf" || type === "cnpj") return maskCpfCnpj(key);
  if (type === "phone") return maskPhone(key);
  return key;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boleto: Boleto | null;
  companyId: string;
  onSuccess: (updated: Boleto) => void;
};

export function EditBoletoSheet({
  open,
  onOpenChange,
  boleto,
  companyId,
  onSuccess,
}: Props) {
  const isTransfer = boleto ? isBoletoTransfer(boleto) : false;

  const [description, setDescription] = useState("");
  const [emissionDate, setEmissionDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [amount, setAmount] = useState("");
  const [companyCategoryId, setCompanyCategoryId] = useState("");
  const [companyCategories, setCompanyCategories] = useState<CompanyCategory[]>(
    [],
  );
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [createSupplierOpen, setCreateSupplierOpen] = useState(false);
  const [paymentType, setPaymentType] = useState<PaymentType>("boleto");
  const [barcode, setBarcode] = useState("");
  const [provider, setProvider] = useState("");
  const [pixKeyType, setPixKeyType] = useState("cpf");
  const [pixKey, setPixKey] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankCode, setBankCode] = useState("");
  const [agency, setAgency] = useState("");
  const [account, setAccount] = useState("");
  const [accountType, setAccountType] = useState("conta_corrente");
  const [loading, setLoading] = useState(false);
  const [expenseItems, setExpenseItems] = useState<ExpenseItem[]>([]);
  const [expenseProducts, setExpenseProducts] = useState<Product[]>([]);
  const [linkedExpenseType, setLinkedExpenseType] = useState<ExpenseType | null>(
    null,
  );
  const [rateioEnabled, setRateioEnabled] = useState(false);
  const [rateioLines, setRateioLines] = useState<RateioDraftLine[]>(() =>
    initialRateioLines(""),
  );
  const prevRateioTotalRef = useRef(0);

  const supplierSelectOptions = useMemo(
    () => suppliers.map(supplierSearchOption),
    [suppliers],
  );

  const fillFromBoleto = useCallback((row: Boleto) => {
    setDescription(row.description ?? "");
    setEmissionDate((row.emission_date ?? row.due_date).slice(0, 10));
    setDueDate(row.due_date.slice(0, 10));
    setAmount(String(row.amount ?? ""));
    setCompanyCategoryId(row.company_category_id ?? "");
    setSupplierId(row.supplier_id ?? "");
    const pt = (row.payment_type ?? "boleto") as PaymentType;
    setPaymentType(pt);
    setBarcode(row.barcode ?? "");
    setProvider(row.provider ?? "");
    const pkt = row.pix_key_type ?? "cpf";
    setPixKeyType(pkt);
    setPixKey(displayPixKey(pkt, row.pix_key ?? ""));
    setBankName(row.bank_name ?? "");
    setBankCode(row.bank_code ?? "");
    setAgency(row.agency ?? "");
    setAccount(row.account ?? "");
    setAccountType(row.account_type ?? "conta_corrente");
  }, []);

  useEffect(() => {
    if (!open || !boleto) return;
    fillFromBoleto(boleto);
  }, [open, boleto, fillFromBoleto]);

  const loadCategories = useCallback(async () => {
    if (!companyId || isTransfer) return;
    const natureza =
      boleto?.flow_type === "receivable" ? "RECEITA" : "DESPESA";
    setCategoriesLoading(true);
    const { data, error } = await supabase
      .from("company_categories")
      .select("*")
      .eq("company_id", companyId)
      .eq("natureza", natureza)
      .eq("ativo", true)
      .order("ordem", { ascending: true })
      .order("name", { ascending: true });
    setCategoriesLoading(false);
    if (error) {
      console.error(error);
      setCompanyCategories([]);
      return;
    }
    setCompanyCategories((data ?? []) as CompanyCategory[]);
  }, [companyId, isTransfer, boleto?.flow_type]);

  const loadSuppliers = useCallback(async () => {
    if (!companyId || isTransfer) return;
    const { data, error } = await supabase
      .from("suppliers")
      .select("*, supplier_payment_info (*)")
      .eq("company_id", companyId)
      .order("name");
    if (error) {
      console.error(error);
      setSuppliers([]);
      return;
    }
    setSuppliers(((data ?? []) as Supplier[]).map(mapSupplierRow));
  }, [companyId, isTransfer]);

  const loadLinkedExpense = useCallback(async () => {
    const expenseId = boleto?.expense_id;
    if (!open || !companyId || !expenseId || isTransfer) {
      setExpenseItems([]);
      setExpenseProducts([]);
      setLinkedExpenseType(null);
      setRateioEnabled(false);
      setRateioLines(initialRateioLines(boleto?.company_category_id ?? ""));
      return;
    }
    const [{ data: itemRows }, { data: prodRows }, { data: expRow }] =
      await Promise.all([
        supabase
          .from("expense_items")
          .select(
            "*, products (id, name, current_quantity, min_quantity, unit)",
          )
          .eq("company_id", companyId)
          .eq("expense_id", expenseId)
          .order("created_at", { ascending: true }),
        supabase
          .from("products")
          .select("*")
          .eq("company_id", companyId)
          .order("name"),
        supabase
          .from("expenses")
          .select("id, type")
          .eq("id", expenseId)
          .eq("company_id", companyId)
          .maybeSingle(),
      ]);
    const items = (itemRows as ExpenseItem[]) ?? [];
    setExpenseItems(items);
    setExpenseProducts((prodRows as Product[]) ?? []);
    const expenseType = (expRow?.type as ExpenseType | undefined) ?? null;
    setLinkedExpenseType(expenseType);
    if (isMerchandiseExpenseForRateio(expenseType, items)) {
      setRateioEnabled(false);
      return;
    }
    if (isCategoryRateioStubItems(items)) {
      setRateioEnabled(true);
      setRateioLines(draftLinesFromExpenseItems(items));
      prevRateioTotalRef.current = Number(boleto?.amount) || 0;
    } else {
      setRateioEnabled(false);
      setRateioLines(initialRateioLines(boleto?.company_category_id ?? ""));
    }
  }, [open, companyId, boleto?.expense_id, boleto?.amount, boleto?.company_category_id, isTransfer]);

  useEffect(() => {
    if (!open || !companyId) return;
    void loadCategories();
    void loadSuppliers();
    void loadLinkedExpense();
  }, [open, companyId, loadCategories, loadSuppliers, loadLinkedExpense]);

  const applySupplierPayment = (supplier: Supplier | undefined) => {
    const info = supplier?.payment_info;
    if (!info) return;
    if (info.pix_key?.trim() && info.pix_type?.trim()) {
      setPaymentType("pix");
      setPixKeyType(info.pix_type);
      setPixKey(displayPixKey(info.pix_type, info.pix_key));
      return;
    }
    if (info.bank_name?.trim() && info.agency?.trim() && info.account?.trim()) {
      setPaymentType("ted");
      setBankName(info.bank_name ?? "");
      setBankCode(info.bank_code ?? "");
      setAgency(info.agency ?? "");
      setAccount(info.account ?? "");
      setAccountType(info.account_type ?? "conta_corrente");
      setProvider(supplier?.name ?? "");
    }
  };

  const handleSupplierChange = (value: string) => {
    if (value === "__create__") {
      setCreateSupplierOpen(true);
      return;
    }
    setSupplierId(value);
    applySupplierPayment(suppliers.find((s) => s.id === value));
  };

  const amountNum = parseFloat(amount);
  const hasLinkedExpense = Boolean(boleto?.expense_id);
  const merchandiseLinked = isMerchandiseExpenseForRateio(
    linkedExpenseType,
    expenseItems,
  );
  const allowRateio = !isTransfer && !merchandiseLinked;
  const categoryNatureza =
    boleto?.flow_type === "receivable" ? "RECEITA" : "DESPESA";
  const rateioValidation =
    allowRateio && rateioEnabled
      ? validateRateioDraft(rateioLines, amountNum)
      : { ok: true as const };
  const categoryOk = allowRateio
    ? rateioEnabled
      ? rateioValidation.ok
      : companyCategoryId.trim() !== ""
    : hasLinkedExpense || companyCategoryId.trim() !== "";
  const canSubmit =
    !!boleto &&
    boleto.status === "pending" &&
    description.trim() !== "" &&
    emissionDate.trim() !== "" &&
    dueDate.trim() !== "" &&
    Number.isFinite(amountNum) &&
    amountNum > 0 &&
    (isTransfer ||
      (categoryOk &&
        !categoriesLoading &&
        (paymentType === "boleto" ||
          (paymentType === "pix" && pixKey.trim() !== "") ||
          (paymentType === "ted" &&
            bankName.trim() !== "" &&
            agency.trim() !== "" &&
            account.trim() !== ""))));

  useEffect(() => {
    if (!allowRateio || !rateioEnabled) {
      prevRateioTotalRef.current = Number.isFinite(amountNum) ? amountNum : 0;
      return;
    }
    const total = Number.isFinite(amountNum) && amountNum > 0 ? amountNum : 0;
    const prev = prevRateioTotalRef.current;
    if (prev > 0 && total > 0 && prev !== total) {
      setRateioLines((lines) => scaleRateioLines(lines, total));
    }
    prevRateioTotalRef.current = total;
  }, [allowRateio, rateioEnabled, amountNum]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!boleto || !companyId || !canSubmit) return;
    setLoading(true);

    const shared = {
      description: description.trim(),
      emission_date: emissionDate,
      due_date: dueDate,
      amount: amountNum,
      updated_at: new Date().toISOString(),
    };

    if (isTransfer && boleto.transfer_group_id) {
      const { error } = await supabase
        .from("boletos")
        .update(shared)
        .eq("company_id", companyId)
        .eq("transfer_group_id", boleto.transfer_group_id)
        .eq("entry_kind", "transfer");
      if (error) {
        setLoading(false);
        toast.error(error.message ?? "Não foi possível salvar a transferência.");
        return;
      }
      const { data, error: reloadErr } = await supabase
        .from("boletos")
        .select("*")
        .eq("id", boleto.id)
        .eq("company_id", companyId)
        .single();
      setLoading(false);
      if (reloadErr || !data) {
        toast.error("Alteração salva, mas a conta não foi recarregada.");
        onSuccess({ ...boleto, ...shared });
        onOpenChange(false);
        return;
      }
      onSuccess(data as Boleto);
      onOpenChange(false);
      toast.success("Transferência atualizada.");
      void syncCompanyAlerts(companyId);
      return;
    }

    const useRateio = allowRateio && rateioEnabled;
    if (useRateio) {
      const check = validateRateioDraft(rateioLines, amountNum);
      if (!check.ok) {
        setLoading(false);
        toast.error(check.message);
        return;
      }
    }
    const resolvedCategoryId = useRateio
      ? primaryCategoryIdFromRateio(rateioLines)
      : companyCategoryId.trim() || null;

    let linkedExpenseId = boleto.expense_id ?? null;
    if (allowRateio) {
      try {
        if (useRateio && !linkedExpenseId) {
          const {
            data: { user },
          } = await supabase.auth.getUser();
          const selectedSupplier = supplierId
            ? suppliers.find((s) => s.id === supplierId)
            : null;
          linkedExpenseId = await createReciboExpense({
            companyId,
            userId: user?.id ?? null,
            description: description.trim(),
            dueDate,
            amount: amountNum,
            supplierId: selectedSupplier?.id ?? null,
            supplierName: selectedSupplier?.name ?? null,
            supplierDocument: selectedSupplier?.document ?? null,
            seriesType: "single",
          });
        }
        if (linkedExpenseId && (useRateio || linkedExpenseType === "recibo")) {
          await replaceExpenseItemsForRateio({
            companyId,
            expenseId: linkedExpenseId,
            lines: useRateio ? rateioLines : null,
            categories: companyCategories,
            stubProductName: description.trim(),
            stubUnitValue: amountNum,
          });
          await supabase
            .from("expenses")
            .update({
              document_total: amountNum,
              display_name: description.trim(),
              reference_date: dueDate,
            })
            .eq("id", linkedExpenseId)
            .eq("company_id", companyId);
        }
      } catch (err) {
        setLoading(false);
        toast.error(
          err instanceof Error
            ? err.message
            : "Não foi possível salvar o rateio.",
        );
        return;
      }
    }

    const payload: Record<string, unknown> = {
      ...shared,
      company_category_id: resolvedCategoryId,
      supplier_id: supplierId || null,
      payment_type: paymentType,
    };
    if (linkedExpenseId) payload.expense_id = linkedExpenseId;

    if (paymentType === "boleto") {
      payload.barcode = barcode.trim() || null;
      payload.provider = provider.trim() || null;
      payload.pix_key_type = null;
      payload.pix_key = null;
      payload.bank_name = null;
      payload.bank_code = null;
      payload.agency = null;
      payload.account = null;
      payload.account_type = null;
    } else if (paymentType === "pix") {
      payload.barcode = null;
      payload.provider = provider.trim() || null;
      payload.pix_key_type = pixKeyType;
      payload.pix_key =
        pixKeyType === "cpf" || pixKeyType === "cnpj"
          ? pixKey.replace(/\D/g, "") || null
          : pixKey.trim() || null;
      payload.bank_name = null;
      payload.bank_code = null;
      payload.agency = null;
      payload.account = null;
      payload.account_type = null;
    } else {
      payload.barcode = null;
      payload.provider = provider.trim() || null;
      payload.pix_key_type = null;
      payload.pix_key = null;
      payload.bank_name = bankName.trim() || null;
      payload.bank_code = bankCode.trim() || null;
      payload.agency = agency.trim() || null;
      payload.account = account.trim() || null;
      payload.account_type = accountType;
    }

    const { data, error } = await supabase
      .from("boletos")
      .update(payload)
      .eq("id", boleto.id)
      .eq("company_id", companyId)
      .eq("status", "pending")
      .select()
      .single();
    setLoading(false);
    if (error || !data) {
      toast.error(error?.message ?? "Não foi possível salvar a conta.");
      return;
    }
    onSuccess(data as Boleto);
    onOpenChange(false);
    toast.success("Conta atualizada.");
    void syncCompanyAlerts(companyId);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          maximizable
          className="z-[70] overflow-y-auto w-[70vw] sm:!max-w-[70vw]"
          overlayClassName="z-[70]"
        >
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5" />
              Editar conta
            </SheetTitle>
            <SheetDescription>
              {isTransfer
                ? "Altere descrição, valor, emissão e vencimento das duas pernas da transferência."
                : boleto?.flow_type === "receivable"
                  ? "Altere os dados desta conta a receber em aberto, inclusive o vencimento."
                  : "Altere os dados desta conta a pagar em aberto, inclusive o vencimento."}
            </SheetDescription>
          </SheetHeader>
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 py-4">
            {!isTransfer && (
              <>
                <div>
                  <Label>Forma de pagamento</Label>
                  <Select
                    value={paymentType}
                    onValueChange={(v) => setPaymentType(v as PaymentType)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[80]">
                      <SelectItem value="boleto">
                        {PAYMENT_TYPE_LABELS.boleto}
                      </SelectItem>
                      <SelectItem value="pix">
                        {PAYMENT_TYPE_LABELS.pix}
                      </SelectItem>
                      <SelectItem value="ted">
                        {PAYMENT_TYPE_LABELS.ted}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-3">
                  {allowRateio ? (
                    <>
                      {!rateioEnabled ? (
                        <div>
                          <Label>Categoria</Label>
                          <BoletoCategoryPicker
                            companyId={companyId}
                            value={companyCategoryId}
                            onValueChange={setCompanyCategoryId}
                            categories={companyCategories}
                            loading={categoriesLoading}
                            categoryNatureza={categoryNatureza}
                            onReload={() => void loadCategories()}
                          />
                        </div>
                      ) : null}
                      <BoletoCategoryRateioFields
                        companyId={companyId}
                        categories={companyCategories}
                        loading={categoriesLoading}
                        onReload={() => void loadCategories()}
                        categoryNatureza={categoryNatureza}
                        totalAmount={Number.isFinite(amountNum) ? amountNum : 0}
                        enabled={rateioEnabled}
                        onEnabledChange={(next) => {
                          setRateioEnabled(next);
                          if (next) {
                            setRateioLines(
                              initialRateioLines(companyCategoryId),
                            );
                            prevRateioTotalRef.current =
                              Number.isFinite(amountNum) && amountNum > 0
                                ? amountNum
                                : 0;
                          } else {
                            const first = rateioLines.find((l) => l.categoryId);
                            if (first?.categoryId) {
                              setCompanyCategoryId(first.categoryId);
                            }
                          }
                        }}
                        lines={rateioLines}
                        onLinesChange={setRateioLines}
                        disabled={boleto?.status !== "pending"}
                      />
                    </>
                  ) : (
                    <div>
                      <Label>
                        {hasLinkedExpense
                          ? "Categoria da conta (fallback)"
                          : "Categoria"}
                      </Label>
                      <BoletoCategoryPicker
                        companyId={companyId}
                        value={companyCategoryId}
                        onValueChange={setCompanyCategoryId}
                        categories={companyCategories}
                        loading={categoriesLoading}
                        categoryNatureza={categoryNatureza}
                        onReload={() => void loadCategories()}
                        allowClear={hasLinkedExpense}
                      />
                      {hasLinkedExpense ? (
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          Usada nas linhas da nota sem categoria. O DRE rateia
                          pelos itens classificados.
                        </p>
                      ) : null}
                    </div>
                  )}
                </div>
                <div>
                  <Label>Fornecedor</Label>
                  <SearchSelect
                    value={supplierId === "__create__" ? "" : supplierId}
                    onValueChange={handleSupplierChange}
                    options={supplierSelectOptions}
                    trailingOptions={[
                      {
                        value: "__create__",
                        label: "Criar fornecedor",
                        accent: true,
                      },
                    ]}
                    placeholder="Selecione o fornecedor (opcional)"
                    searchPlaceholder="Buscar fornecedor…"
                    emptyMessage="Nenhum fornecedor encontrado."
                  />
                </div>
              </>
            )}

            {merchandiseLinked && expenseItems.length > 0 ? (
              <ExpenseItemsInlineTable
                items={expenseItems}
                canEdit={boleto?.status === "pending"}
                companyId={companyId}
                products={expenseProducts}
                deferProductCreation={false}
                highlightMissingVinculo={false}
                onSaved={(created) => {
                  if (created) {
                    setExpenseProducts((prev) => {
                      if (prev.some((p) => p.id === created.id)) return prev;
                      return [...prev, created].sort((a, b) =>
                        a.name.localeCompare(b.name, "pt-BR"),
                      );
                    });
                  }
                  void loadLinkedExpense();
                }}
              />
            ) : null}

            <div>
              <Label>Descrição</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Emissão</Label>
                <Input
                  type="date"
                  value={emissionDate}
                  onChange={(e) => setEmissionDate(e.target.value)}
                />
              </div>
              <div>
                <Label>Vencimento</Label>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label>Valor (R$)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>

            {!isTransfer && paymentType === "boleto" && (
              <div>
                <Label>Código de barras</Label>
                <Input
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  placeholder="Opcional"
                />
              </div>
            )}

            {!isTransfer && paymentType === "pix" && (
              <div className="space-y-4 rounded-lg border p-4">
                <Label>Chave PIX</Label>
                <div className="flex gap-4">
                  <div>
                    <Label className="text-xs">Tipo da chave</Label>
                    <Select value={pixKeyType} onValueChange={setPixKeyType}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="z-[80]">
                        {PIX_KEY_TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex-1">
                    <Label className="text-xs">Chave</Label>
                    <Input
                      value={pixKey}
                      onChange={(e) =>
                        setPixKey(
                          pixKeyType === "cpf" || pixKeyType === "cnpj"
                            ? maskCpfCnpj(e.target.value)
                            : pixKeyType === "phone"
                              ? maskPhone(e.target.value)
                              : e.target.value,
                        )
                      }
                    />
                  </div>
                </div>
              </div>
            )}

            {!isTransfer && paymentType === "ted" && (
              <div className="space-y-4 rounded-lg border p-4">
                <Label>Dados bancários</Label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs">Banco</Label>
                    <Input
                      value={bankName}
                      onChange={(e) => setBankName(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Código</Label>
                    <Input
                      value={bankCode}
                      onChange={(e) => setBankCode(e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs">Agência</Label>
                    <Input
                      value={agency}
                      onChange={(e) => setAgency(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Conta</Label>
                    <Input
                      value={account}
                      onChange={(e) => setAccount(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Tipo de conta</Label>
                  <Select value={accountType} onValueChange={setAccountType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="z-[80]">
                      {ACCOUNT_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Beneficiário (opcional)</Label>
                  <Input
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                  />
                </div>
              </div>
            )}

            <SheetFooter>
              <Button type="submit" disabled={!canSubmit || loading}>
                {loading ? "Salvando..." : "Salvar alterações"}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
      <CreateSupplierSheet
        open={createSupplierOpen}
        onOpenChange={setCreateSupplierOpen}
        companyId={companyId}
        onSuccess={async (supplier) => {
          const { data } = await supabase
            .from("suppliers")
            .select("*, supplier_payment_info (*)")
            .eq("id", supplier.id)
            .single();
          const mapped = data
            ? mapSupplierRow(
                data as Supplier & {
                  supplier_payment_info?:
                    | Supplier["payment_info"]
                    | Supplier["payment_info"][];
                },
              )
            : supplier;
          setSuppliers((prev) =>
            [...prev.filter((s) => s.id !== mapped.id), mapped].sort((a, b) =>
              a.name.localeCompare(b.name, "pt-BR"),
            ),
          );
          setSupplierId(mapped.id);
          applySupplierPayment(mapped);
        }}
      />
    </>
  );
}
