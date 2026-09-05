import { BoletoCategoryPicker } from "@/components/BoletoCategoryPicker";
import { BoletoCategoryRateioFields } from "@/components/BoletoCategoryRateioFields";
import { CreateBankAccountSheet } from "@/components/CreateBankAccountSheet";
import { CreateSupplierSheet } from "@/components/CreateSupplierSheet";
import { ExpenseItemsInlineTable } from "@/components/expenses/ExpenseItemsInlineTable";
import { PayableProductDraftFields } from "@/components/PayableProductDraftFields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PRODUCT_SHEET_INPUT,
  PRODUCT_SHEET_SELECT,
  PRODUCT_SHEET_SECTION,
} from "@/components/products/productSheetStyles";
import {
  SEARCH_SELECT_WIDE_POPOVER_CLASS,
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
import {
  createReciboExpense,
  emptyPayableProductLine,
  filledPayableProductLines,
  initialRateioLines,
  insertExpenseItemsForProducts,
  primaryCategoryIdFromRateio,
  replaceExpenseItemsForRateio,
  scaleRateioLines,
  validatePayableProductDraft,
  validateRateioDraft,
  type PayableProductDraftLine,
  type RateioDraftLine,
} from "@/lib/boletoCategoryRateio";
import { localDateYmd } from "@/lib/boletoPayment";
import {
  buildChildrenMap,
  isLeafCategory,
  isSelectableDespesaLeaf,
  isSelectableReceitaLeaf,
} from "@/lib/companyCategoryLabels";
import { syncCompanyAlerts } from "@/lib/companyAlerts/syncCompanyAlerts";
import { documentDigitsFromQuery } from "@/lib/applyFocusCnpjToSupplier";
import { maskCpfCnpj, maskPhone } from "@/lib/masks";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import {
  bankAccountTypeLabel,
  type CompanyBankAccount,
} from "@/types/bankAccount";
import type { CompanyCategory } from "@/types/category";
import type { Boleto, BoletoFlowType, ExpenseItem, PaymentType } from "@/types/expense";
import type { Supplier } from "@/types/supplier";
import type { Product } from "@/types/product";
import type {
  ExpenseSeriesType,
  RecurrenceFrequency,
} from "@/types/expenseSeries";
import {
  ArrowLeftRight,
  Building2,
  FileText,
  Landmark,
  Plus,
  QrCode,
  Receipt,
  Repeat,
  Wallet,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

/** Opções do select "Tipo de lançamento" (série + transferência). */
export type BoletoLaunchType = ExpenseSeriesType | "transfer";
type LaunchTypeSelect = BoletoLaunchType;

function pickDefaultCategoryId(list: CompanyCategory[]): string {
  const leaves = list.filter(isSelectableDespesaLeaf);
  const outras = leaves.find(
    (c) => c.name.trim().toLowerCase() === "outras - variáveis",
  );
  if (outras) return outras.id;
  const sorted = [...leaves].sort((a, b) => {
    const ao = a.ordem ?? a.sort_order ?? 0;
    const bo = b.ordem ?? b.sort_order ?? 0;
    if (ao !== bo) return ao - bo;
    return a.name.localeCompare(b.name, "pt-BR");
  });
  return sorted[0]?.id ?? "";
}

function pickDefaultReceitaCategoryId(list: CompanyCategory[]): string {
  const childrenMap = buildChildrenMap(list);
  const leaves = list.filter(
    (c) =>
      isSelectableReceitaLeaf(c) && isLeafCategory(c.id, childrenMap),
  );
  const outras = leaves.find((c) =>
    c.name.trim().toLowerCase().includes("outras receitas"),
  );
  if (outras) return outras.id;
  const sorted = [...leaves].sort((a, b) => {
    const ao = a.ordem ?? a.sort_order ?? 0;
    const bo = b.ordem ?? b.sort_order ?? 0;
    if (ao !== bo) return ao - bo;
    return a.name.localeCompare(b.name, "pt-BR");
  });
  return sorted[0]?.id ?? "";
}

function pickDefaultForFlow(list: CompanyCategory[], flow: BoletoFlowType) {
  return flow === "receivable"
    ? pickDefaultReceitaCategoryId(list)
    : pickDefaultCategoryId(list);
}

const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  boleto: "Boleto",
  pix: "PIX",
  ted: "TED",
};

const LAUNCH_TYPE_OPTIONS: {
  value: LaunchTypeSelect;
  label: string;
  hint: string;
  icon: ReactNode;
}[] = [
  {
    value: "single",
    label: "Única",
    hint: "Um pagamento",
    icon: <Receipt className="h-4 w-4" />,
  },
  {
    value: "recurring",
    label: "Recorrente",
    hint: "Repete sozinha",
    icon: <Repeat className="h-4 w-4" />,
  },
  {
    value: "installment",
    label: "Parcelada",
    hint: "Várias parcelas",
    icon: <Wallet className="h-4 w-4" />,
  },
  {
    value: "transfer",
    label: "Transferência",
    hint: "Entre contas",
    icon: <ArrowLeftRight className="h-4 w-4" />,
  },
];

const PAYMENT_TYPE_OPTIONS: {
  value: PaymentType;
  hint: string;
  icon: ReactNode;
}[] = [
  {
    value: "boleto",
    hint: "Código de barras",
    icon: <FileText className="h-4 w-4" />,
  },
  {
    value: "pix",
    hint: "Chave PIX",
    icon: <QrCode className="h-4 w-4" />,
  },
  {
    value: "ted",
    hint: "Dados bancários",
    icon: <Landmark className="h-4 w-4" />,
  },
];

function ChoiceCard({
  selected,
  onSelect,
  icon,
  label,
  hint,
}: {
  selected: boolean;
  onSelect: () => void;
  icon: ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex items-start gap-3 rounded-xl border p-3 text-left shadow-sm transition-colors",
        selected
          ? "border-primary bg-primary/5 ring-1 ring-primary"
          : "border-border bg-background hover:bg-accent/50",
      )}
    >
      <div
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
          selected
            ? "bg-primary/10 text-primary"
            : "bg-muted text-muted-foreground",
        )}
      >
        {icon}
      </div>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {hint}
        </span>
      </span>
    </button>
  );
}

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

function suggestPaymentFromSupplier(
  supplier: Supplier,
  setters: {
    setPaymentType: (v: PaymentType) => void;
    setPixKeyType: (v: string) => void;
    setPixKey: (v: string) => void;
    setBankName: (v: string) => void;
    setBankCode: (v: string) => void;
    setAgency: (v: string) => void;
    setAccount: (v: string) => void;
    setAccountType: (v: string) => void;
    setProvider: (v: string) => void;
  },
): boolean {
  const info = supplier.payment_info;
  if (!info) return false;

  if (info.pix_key?.trim() && info.pix_type?.trim()) {
    setters.setPaymentType("pix");
    setters.setPixKeyType(info.pix_type);
    const key = info.pix_key;
    if (info.pix_type === "cpf" || info.pix_type === "cnpj") {
      setters.setPixKey(maskCpfCnpj(key));
    } else if (info.pix_type === "phone") {
      setters.setPixKey(maskPhone(key));
    } else {
      setters.setPixKey(key);
    }
    return true;
  }

  if (
    info.bank_name?.trim() &&
    info.agency?.trim() &&
    info.account?.trim()
  ) {
    setters.setPaymentType("ted");
    setters.setBankName(info.bank_name ?? "");
    setters.setBankCode(info.bank_code ?? "");
    setters.setAgency(info.agency ?? "");
    setters.setAccount(info.account ?? "");
    setters.setAccountType(info.account_type ?? "conta_corrente");
    setters.setProvider(supplier.name);
    return true;
  }

  return false;
}

interface CreateBoletoSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  expenseId?: string | null;
  /** YYYY-MM-DD — preenche vencimento ao abrir (ex.: dia clicado no calendário) */
  defaultDueDate?: string | null;
  /** Valor inicial ao abrir (ex.: conciliação a partir do extrato). */
  defaultAmount?: number | null;
  /** Descrição inicial ao abrir. */
  defaultDescription?: string | null;
  /** Tipo de lançamento ao abrir sem despesa vinculada (quando não há `fixedAccountFlow`). */
  defaultAccountFlow?: BoletoFlowType;
  /** Fixa o fluxo e oculta o seletor conta a pagar / a receber (ex.: página de Contas a pagar). */
  fixedAccountFlow?: BoletoFlowType;
  /** Prefill do tipo de lançamento (única, transferência, etc.). */
  defaultLaunchType?: BoletoLaunchType;
  /** Categoria inicial ao abrir (ex.: memória da conciliação). */
  defaultCategoryId?: string | null;
  defaultOriginBankAccountId?: string | null;
  defaultDestBankAccountId?: string | null;
  onSuccess?: (boleto: Boleto) => void;
}

export function CreateBoletoSheet({
  open,
  onOpenChange,
  companyId,
  expenseId,
  defaultDueDate,
  defaultAmount,
  defaultDescription,
  defaultAccountFlow = "payable",
  fixedAccountFlow,
  defaultLaunchType,
  defaultCategoryId,
  defaultOriginBankAccountId,
  defaultDestBankAccountId,
  onSuccess,
}: CreateBoletoSheetProps) {
  const [accountFlow, setAccountFlow] = useState<BoletoFlowType>(
    fixedAccountFlow ?? defaultAccountFlow,
  );
  const [paymentType, setPaymentType] = useState<PaymentType>("boleto");
  const [companyCategories, setCompanyCategories] = useState<
    CompanyCategory[]
  >([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [companyCategoryId, setCompanyCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [emissionDate, setEmissionDate] = useState(() => localDateYmd());
  const [dueDate, setDueDate] = useState("");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);

  // Boleto
  const [barcode, setBarcode] = useState("");
  const [provider, setProvider] = useState("");

  // PIX
  const [pixKeyType, setPixKeyType] = useState("cpf");
  const [pixKey, setPixKey] = useState("");

  // TED
  const [bankName, setBankName] = useState("");
  const [bankCode, setBankCode] = useState("");
  const [agency, setAgency] = useState("");
  const [account, setAccount] = useState("");
  const [accountType, setAccountType] = useState("conta_corrente");

  const [launchType, setLaunchType] = useState<LaunchTypeSelect>(
    defaultLaunchType ?? "single",
  );
  const [recurrenceFrequency, setRecurrenceFrequency] =
    useState<RecurrenceFrequency>("monthly");
  const [installmentCount, setInstallmentCount] = useState("12");

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [createSupplierOpen, setCreateSupplierOpen] = useState(false);
  const [supplierSearchQuery, setSupplierSearchQuery] = useState("");
  const [supplierCreateDocument, setSupplierCreateDocument] = useState("");
  const supplierSearchQueryRef = useRef("");
  const [expenseItems, setExpenseItems] = useState<ExpenseItem[]>([]);
  const [expenseProducts, setExpenseProducts] = useState<Product[]>([]);
  const [rateioEnabled, setRateioEnabled] = useState(false);
  const [rateioLines, setRateioLines] = useState<RateioDraftLine[]>(() =>
    initialRateioLines(""),
  );
  const [productsEnabled, setProductsEnabled] = useState(false);
  const [productLines, setProductLines] = useState<PayableProductDraftLine[]>(
    () => [emptyPayableProductLine()],
  );
  const [generateRecebimento, setGenerateRecebimento] = useState(false);
  const [catalogProducts, setCatalogProducts] = useState<Product[]>([]);
  const prevRateioTotalRef = useRef(0);
  const supplierSelectOptions = useMemo(
    () => suppliers.map(supplierSearchOption),
    [suppliers],
  );

  const [bankAccounts, setBankAccounts] = useState<CompanyBankAccount[]>([]);
  const [originBankAccountId, setOriginBankAccountId] = useState("");
  const [destBankAccountId, setDestBankAccountId] = useState("");
  const [createBankOpen, setCreateBankOpen] = useState(false);
  const [createBankTarget, setCreateBankTarget] = useState<"origin" | "dest">(
    "origin",
  );

  useEffect(() => {
    if (!open) return;
    if (!expenseId) {
      setAccountFlow(fixedAccountFlow ?? defaultAccountFlow);
    }
    setLaunchType(defaultLaunchType ?? "single");
    setEmissionDate(localDateYmd());
    setOriginBankAccountId(defaultOriginBankAccountId?.trim() || "");
    setDestBankAccountId(defaultDestBankAccountId?.trim() || "");
    if (defaultDueDate?.trim()) {
      setDueDate(defaultDueDate.trim().slice(0, 10));
    } else {
      setDueDate("");
    }
    if (defaultAmount != null && Number.isFinite(defaultAmount)) {
      setAmount(String(defaultAmount));
    }
    if (defaultDescription?.trim()) {
      setDescription(defaultDescription.trim());
    }
    setRateioEnabled(false);
    setRateioLines(initialRateioLines(""));
    prevRateioTotalRef.current = 0;
    setProductsEnabled(false);
    setProductLines([emptyPayableProductLine()]);
    setGenerateRecebimento(false);
  }, [
    open,
    defaultDueDate,
    defaultAmount,
    defaultDescription,
    defaultAccountFlow,
    fixedAccountFlow,
    defaultLaunchType,
    defaultOriginBankAccountId,
    defaultDestBankAccountId,
    expenseId,
  ]);

  const effectiveFlow: BoletoFlowType = expenseId
    ? "payable"
    : (fixedAccountFlow ?? accountFlow);
  const isTransfer = launchType === "transfer";
  const seriesType: ExpenseSeriesType = isTransfer ? "single" : launchType;
  const requiresPaymentDetails = effectiveFlow === "payable" && !isTransfer;
  const categoryNatureza =
    effectiveFlow === "receivable" ? "RECEITA" : "DESPESA";
  const allowRateio = !expenseId && !isTransfer;
  const allowProducts =
    !expenseId && !isTransfer && effectiveFlow === "payable";
  const filledProductLines = filledPayableProductLines(productLines);
  const hasLinkedProduct = filledProductLines.length > 0;
  const amountNum = parseFloat(amount);
  const rateioValidation =
    allowRateio && rateioEnabled
      ? validateRateioDraft(rateioLines, amountNum)
      : { ok: true as const };

  const loadCategories = useCallback(
    async (opts?: { selectDefault?: boolean }) => {
      if (!companyId) return;
      const natureza =
        expenseId || effectiveFlow === "payable" ? "DESPESA" : "RECEITA";
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
        if (opts?.selectDefault) setCompanyCategoryId("");
        return;
      }
      const list = (data ?? []) as CompanyCategory[];
      setCompanyCategories(list);
      if (opts?.selectDefault) {
        if (
          defaultCategoryId &&
          list.some((c) => c.id === defaultCategoryId)
        ) {
          setCompanyCategoryId(defaultCategoryId);
        } else {
          const flow = expenseId
            ? "payable"
            : (fixedAccountFlow ?? accountFlow);
          setCompanyCategoryId(pickDefaultForFlow(list, flow));
        }
      }
    },
    [companyId, expenseId, accountFlow, fixedAccountFlow, effectiveFlow, defaultCategoryId],
  );

  useEffect(() => {
    if (!open || !companyId) return;
    void loadCategories({ selectDefault: true });
  }, [open, companyId, loadCategories]);

  const loadSuppliers = useCallback(async () => {
    if (!companyId) return;
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
  }, [companyId]);

  useEffect(() => {
    if (!open || !companyId || expenseId || effectiveFlow !== "payable") return;
    void loadSuppliers();
  }, [open, companyId, expenseId, effectiveFlow, loadSuppliers]);

  const loadLinkedExpense = useCallback(async () => {
    if (!open || !companyId || !expenseId) {
      setExpenseItems([]);
      setExpenseProducts([]);
      return;
    }
    const [{ data: itemRows }, { data: prodRows }] = await Promise.all([
      supabase
        .from("expense_items")
        .select("*, products (id, name, current_quantity, min_quantity, unit)")
        .eq("company_id", companyId)
        .eq("expense_id", expenseId)
        .order("created_at", { ascending: true }),
      supabase
        .from("products")
        .select("*")
        .eq("company_id", companyId)
        .order("name"),
    ]);
    setExpenseItems((itemRows as ExpenseItem[]) ?? []);
    setExpenseProducts((prodRows as Product[]) ?? []);
  }, [open, companyId, expenseId]);

  useEffect(() => {
    void loadLinkedExpense();
  }, [loadLinkedExpense]);

  const loadCatalogProducts = useCallback(async () => {
    if (!companyId) return;
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("company_id", companyId)
      .order("name");
    if (error) {
      console.error(error);
      setCatalogProducts([]);
      return;
    }
    setCatalogProducts((data as Product[]) ?? []);
  }, [companyId]);

  useEffect(() => {
    if (!open || !companyId || !allowProducts) {
      setCatalogProducts([]);
      return;
    }
    void loadCatalogProducts();
  }, [open, companyId, allowProducts, loadCatalogProducts]);

  const loadBankAccounts = useCallback(async () => {
    if (!companyId) return;
    const { data, error } = await supabase
      .from("company_bank_accounts")
      .select("*")
      .eq("company_id", companyId)
      .order("name", { ascending: true });
    if (error) {
      console.error(error);
      setBankAccounts([]);
      return;
    }
    setBankAccounts((data ?? []) as CompanyBankAccount[]);
  }, [companyId]);

  useEffect(() => {
    if (!open || !companyId || !isTransfer) return;
    void loadBankAccounts();
  }, [open, companyId, isTransfer, loadBankAccounts]);

  const applySupplierSelection = (
    supplier: Supplier | undefined,
    id: string,
  ) => {
    setSupplierId(id);
    if (!supplier) return;
    const suggested = suggestPaymentFromSupplier(supplier, {
      setPaymentType,
      setPixKeyType,
      setPixKey,
      setBankName,
      setBankCode,
      setAgency,
      setAccount,
      setAccountType,
      setProvider,
    });
    if (suggested) {
      toast.info("Dados de pagamento sugeridos a partir do fornecedor");
    }
  };

  const openCreateSupplier = () => {
    setSupplierCreateDocument(
      documentDigitsFromQuery(
        supplierSearchQueryRef.current || supplierSearchQuery,
      ),
    );
    setCreateSupplierOpen(true);
  };

  const handleSupplierChange = (value: string) => {
    if (value === "__create__") {
      openCreateSupplier();
      return;
    }
    applySupplierSelection(
      suppliers.find((s) => s.id === value),
      value,
    );
  };

  const handleOriginBankChange = (value: string) => {
    if (value === "__create__") {
      setCreateBankTarget("origin");
      setCreateBankOpen(true);
      return;
    }
    setOriginBankAccountId(value);
  };

  const handleDestBankChange = (value: string) => {
    if (value === "__create__") {
      setCreateBankTarget("dest");
      setCreateBankOpen(true);
      return;
    }
    setDestBankAccountId(value);
  };

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

  const canSubmitTransfer =
    isTransfer &&
    description.trim() !== "" &&
    emissionDate.trim() !== "" &&
    dueDate.trim() !== "" &&
    parseFloat(amount) > 0 &&
    originBankAccountId !== "" &&
    originBankAccountId !== "__create__" &&
    destBankAccountId !== "" &&
    destBankAccountId !== "__create__" &&
    originBankAccountId !== destBankAccountId;

  const canSubmitStandard =
    !isTransfer &&
    (Boolean(expenseId) ||
      (allowRateio && rateioEnabled
        ? rateioValidation.ok
        : companyCategoryId.trim() !== "")) &&
    (!productsEnabled ||
      (allowProducts && validatePayableProductDraft(productLines).ok)) &&
    !categoriesLoading &&
    description.trim() !== "" &&
    emissionDate.trim() !== "" &&
    dueDate.trim() !== "" &&
    parseFloat(amount) > 0 &&
    (!requiresPaymentDetails ||
      paymentType === "boleto" ||
      (paymentType === "pix" && pixKey.trim() !== "") ||
      (paymentType === "ted" &&
        bankName.trim() !== "" &&
        agency.trim() !== "" &&
        account.trim() !== ""));

  const canSubmit = canSubmitTransfer || canSubmitStandard;

  const resetFormAfterSuccess = () => {
    setDescription("");
    setEmissionDate(localDateYmd());
    setDueDate("");
    setAmount("");
    setBarcode("");
    setProvider("");
    setPixKey("");
    setBankName("");
    setBankCode("");
    setAgency("");
    setAccount("");
    setPaymentType("boleto");
    setAccountFlow(fixedAccountFlow ?? "payable");
    setCompanyCategoryId("");
    setSupplierId("");
    setSupplierSearchQuery("");
    setSupplierCreateDocument("");
    setLaunchType("single");
    setOriginBankAccountId("");
    setDestBankAccountId("");
    setRateioEnabled(false);
    setRateioLines(initialRateioLines(""));
    prevRateioTotalRef.current = 0;
    setProductsEnabled(false);
    setProductLines([emptyPayableProductLine()]);
    setGenerateRecebimento(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId || !canSubmit) return;
    setLoading(true);

    if (isTransfer) {
      if (originBankAccountId === destBankAccountId) {
        setLoading(false);
        toast.error("Conta origem e destino devem ser diferentes.");
        return;
      }
      const transferGroupId = crypto.randomUUID();
      const amountNum = parseFloat(amount);
      const base = {
        company_id: companyId,
        company_category_id: null,
        category: null,
        description: description.trim(),
        emission_date: emissionDate,
        due_date: dueDate,
        amount: amountNum,
        status: "pending" as const,
        entry_kind: "transfer" as const,
        transfer_group_id: transferGroupId,
        payment_type: "ted" as const,
        expense_id: null,
        supplier_id: null,
      };
      const { data, error } = await supabase
        .from("boletos")
        .insert([
          {
            ...base,
            flow_type: "payable",
            company_bank_account_id: originBankAccountId,
          },
          {
            ...base,
            flow_type: "receivable",
            company_bank_account_id: destBankAccountId,
          },
        ])
        .select();
      setLoading(false);
      if (error) {
        console.error(error);
        toast.error(
          error.message ?? "Não foi possível cadastrar a transferência.",
        );
        return;
      }
      const payableBoleto =
        ((data ?? []) as Boleto[]).find((b) => b.flow_type === "payable") ??
        null;
      if (!payableBoleto) {
        toast.error("Transferência criada, mas a saída não foi retornada.");
        return;
      }
      resetFormAfterSuccess();
      onOpenChange(false);
      toast.success("Transferência cadastrada com sucesso.");
      void syncCompanyAlerts(companyId);
      onSuccess?.(payableBoleto);
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    let linkedExpenseId = expenseId ?? null;
    const selectedSupplier = supplierId
      ? suppliers.find((s) => s.id === supplierId)
      : null;

    let resolvedSupplierId = selectedSupplier?.id ?? null;
    if (expenseId && !resolvedSupplierId) {
      const { data: expRow } = await supabase
        .from("expenses")
        .select("supplier_id")
        .eq("id", expenseId)
        .maybeSingle();
      resolvedSupplierId = (expRow?.supplier_id as string | null) ?? null;
    }

    const amountNumSubmit = parseFloat(amount);
    const useRateio = allowRateio && rateioEnabled;
    const useProducts = allowProducts && productsEnabled && hasLinkedProduct;
    if (useRateio) {
      const check = validateRateioDraft(rateioLines, amountNumSubmit);
      if (!check.ok) {
        setLoading(false);
        toast.error(check.message);
        return;
      }
    }
    if (productsEnabled && allowProducts) {
      const check = validatePayableProductDraft(productLines);
      if (!check.ok) {
        setLoading(false);
        toast.error(check.message);
        return;
      }
    }
    const resolvedCategoryId = useRateio
      ? primaryCategoryIdFromRateio(rateioLines)
      : companyCategoryId.trim() || null;

    const needsRecibo =
      !expenseId && (seriesType !== "single" || useRateio || useProducts);

    if (
      !linkedExpenseId &&
      needsRecibo
    ) {
      const installments =
        seriesType === "installment" ? parseInt(installmentCount, 10) : null;
      if (seriesType === "installment" && (!installments || installments < 2)) {
        setLoading(false);
        toast.error("Informe pelo menos 2 parcelas.");
        return;
      }
      try {
        linkedExpenseId = await createReciboExpense({
          companyId,
          userId: user?.id ?? null,
          description: description.trim(),
          dueDate,
          amount: amountNumSubmit,
          supplierId: selectedSupplier?.id ?? null,
          supplierName: selectedSupplier?.name ?? null,
          supplierDocument: selectedSupplier?.document ?? null,
          seriesType,
          recurrenceFrequency,
          installmentCount: installments,
        });
        if (useProducts) {
          await insertExpenseItemsForProducts({
            companyId,
            expenseId: linkedExpenseId,
            lines: productLines,
            companyCategoryId: resolvedCategoryId,
          });
          if (generateRecebimento) {
            const { error: recErr } = await supabase.from("recebimentos").insert({
              company_id: companyId,
              expense_id: linkedExpenseId,
            });
            if (recErr) throw recErr;
          }
        } else {
          await replaceExpenseItemsForRateio({
            companyId,
            expenseId: linkedExpenseId,
            lines: useRateio ? rateioLines : null,
            categories: companyCategories,
            stubProductName: description.trim(),
            stubUnitValue: amountNumSubmit,
          });
        }
      } catch (err) {
        setLoading(false);
        toast.error(
          err instanceof Error
            ? err.message
            : "Não foi possível criar o recibo do lançamento.",
        );
        return;
      }
    }

    const payload: Record<string, unknown> = {
      company_id: companyId,
      company_category_id: resolvedCategoryId,
      category: null,
      description: description.trim(),
      emission_date: emissionDate,
      due_date: dueDate,
      amount: parseFloat(amount),
      status: "pending",
      flow_type: effectiveFlow,
      entry_kind: "standard",
    };
    if (linkedExpenseId) payload.expense_id = linkedExpenseId;
    if (resolvedSupplierId) payload.supplier_id = resolvedSupplierId;

    if (requiresPaymentDetails) {
      payload.payment_type = paymentType;
      if (paymentType === "boleto") {
        payload.barcode = barcode.trim() || null;
        payload.provider = provider.trim() || null;
      } else if (paymentType === "pix") {
        payload.pix_key_type = pixKeyType;
        payload.pix_key =
          (pixKeyType === "cpf" || pixKeyType === "cnpj"
            ? pixKey.replace(/\D/g, "")
            : pixKey.trim()) || null;
      } else {
        payload.bank_name = bankName.trim() || null;
        payload.bank_code = bankCode.trim() || null;
        payload.agency = agency.trim() || null;
        payload.account = account.trim() || null;
        payload.account_type = accountType;
        payload.provider = provider.trim() || null;
      }
    } else {
      payload.payment_type = "boleto";
      payload.barcode = null;
      payload.provider = null;
      payload.pix_key_type = null;
      payload.pix_key = null;
      payload.bank_name = null;
      payload.bank_code = null;
      payload.agency = null;
      payload.account = null;
      payload.account_type = null;
    }

    const { data, error } = await supabase
      .from("boletos")
      .insert(payload)
      .select()
      .single();
    setLoading(false);
    if (error) {
      console.error(error);
      toast.error(error.message ?? "Não foi possível cadastrar a conta.");
      return;
    }
    const boleto = data as Boleto;
    resetFormAfterSuccess();
    onOpenChange(false);
    toast.success(
      generateRecebimento && useProducts
        ? "Conta cadastrada. O recebimento aparece em Notas e recebimento."
        : "Conta cadastrada com sucesso.",
    );
    void syncCompanyAlerts(companyId);
    onSuccess?.(boleto);
  };

  const sheetTitle = expenseId
    ? "Novo pagamento"
    : isTransfer
      ? "Nova transferência"
      : effectiveFlow === "receivable"
        ? "Nova conta a receber"
        : "Nova conta a pagar";
  const sheetDescription = expenseId
    ? "Cadastre boleto, PIX ou TED para vincular à despesa."
    : isTransfer
      ? "Movimenta valor entre contas bancárias, fora do fluxo e da DRE."
      : effectiveFlow === "receivable"
        ? "Registre valores a receber (entrada no fluxo de caixa)."
        : "Quem pagar, quanto e quando — em poucos passos.";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        maximizable
        className="flex h-full max-h-[100dvh] w-full flex-col gap-0 overflow-hidden border-l border-border bg-background p-0"
      >
        <SheetHeader className="shrink-0 border-b border-border bg-card px-6 pb-5 pt-6 text-left">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border bg-muted shadow-sm">
              <FileText className="h-6 w-6 text-primary" />
            </div>
            <div className="min-w-0 flex-1 space-y-1 pr-6">
              <SheetTitle className="text-xl font-semibold sm:text-2xl">
                {sheetTitle}
              </SheetTitle>
              <SheetDescription>{sheetDescription}</SheetDescription>
            </div>
          </div>
        </SheetHeader>
        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 overflow-y-auto bg-muted">
            <div className="space-y-4 p-6">
            {!expenseId &&
              effectiveFlow === "payable" &&
              defaultLaunchType == null && (
              <div className={PRODUCT_SHEET_SECTION}>
                <p className="mb-1 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                  Tipo
                </p>
                <p className="mb-4 text-sm text-muted-foreground">
                  Como esta conta entra no fluxo.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {LAUNCH_TYPE_OPTIONS.map((opt) => (
                    <ChoiceCard
                      key={opt.value}
                      selected={launchType === opt.value}
                      onSelect={() => setLaunchType(opt.value)}
                      icon={opt.icon}
                      label={opt.label}
                      hint={opt.hint}
                    />
                  ))}
                </div>
                {!isTransfer && launchType === "recurring" && (
                  <div className="mt-4 space-y-2">
                    <Label>Recorrência</Label>
                    <Select
                      value={recurrenceFrequency}
                      onValueChange={(v) =>
                        setRecurrenceFrequency(v as RecurrenceFrequency)
                      }
                    >
                      <SelectTrigger className={PRODUCT_SHEET_SELECT}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="weekly">Semanal</SelectItem>
                        <SelectItem value="biweekly">Quinzenal</SelectItem>
                        <SelectItem value="monthly">Mensal</SelectItem>
                        <SelectItem value="bimonthly">Bimestral</SelectItem>
                        <SelectItem value="quarterly">Trimestral</SelectItem>
                        <SelectItem value="semiannual">Semestral</SelectItem>
                        <SelectItem value="annual">Anual</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      De quanto em quanto tempo esta despesa se repete.
                    </p>
                  </div>
                )}
                {!isTransfer && launchType === "installment" && (
                  <div className="mt-4 space-y-2">
                    <Label htmlFor="installment-count">Número de parcelas</Label>
                    <Input
                      id="installment-count"
                      type="number"
                      min={2}
                      max={360}
                      value={installmentCount}
                      onChange={(e) => setInstallmentCount(e.target.value)}
                      className={PRODUCT_SHEET_INPUT}
                    />
                  </div>
                )}
                {isTransfer && (
                  <p className="mt-4 text-sm text-muted-foreground">
                    Cria uma saída na conta origem e uma entrada na conta
                    destino, sem categoria e sem impacto na DRE.
                  </p>
                )}
              </div>
            )}
            {isTransfer && (
              <div className={PRODUCT_SHEET_SECTION}>
                <p className="mb-4 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                  Contas
                </p>
                <div className="space-y-4">
                <div>
                  <Label>Conta origem</Label>
                  <Select
                    value={
                      originBankAccountId === "__create__"
                        ? ""
                        : originBankAccountId
                    }
                    onValueChange={handleOriginBankChange}
                  >
                    <SelectTrigger className={cn("w-full", PRODUCT_SHEET_SELECT)}>
                      <SelectValue placeholder="Selecione a conta de saída" />
                    </SelectTrigger>
                    <SelectContent>
                      {bankAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name} ({bankAccountTypeLabel(a.tipo)})
                        </SelectItem>
                      ))}
                      <SelectItem
                        value="__create__"
                        className="text-primary font-medium"
                      >
                        <Plus className="h-4 w-4 inline mr-2" />
                        Criar conta bancária
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Conta destino</Label>
                  <Select
                    value={
                      destBankAccountId === "__create__"
                        ? ""
                        : destBankAccountId
                    }
                    onValueChange={handleDestBankChange}
                  >
                    <SelectTrigger className={cn("w-full", PRODUCT_SHEET_SELECT)}>
                      <SelectValue placeholder="Selecione a conta de entrada" />
                    </SelectTrigger>
                    <SelectContent>
                      {bankAccounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name} ({bankAccountTypeLabel(a.tipo)})
                        </SelectItem>
                      ))}
                      <SelectItem
                        value="__create__"
                        className="text-primary font-medium"
                      >
                        <Plus className="h-4 w-4 inline mr-2" />
                        Criar conta bancária
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                </div>
              </div>
            )}
            {requiresPaymentDetails && (
              <div className={PRODUCT_SHEET_SECTION}>
                <p className="mb-1 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                  Pagamento
                </p>
                <p className="mb-4 text-sm text-muted-foreground">
                  Como você vai pagar esta conta.
                </p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {PAYMENT_TYPE_OPTIONS.map((opt) => (
                    <ChoiceCard
                      key={opt.value}
                      selected={paymentType === opt.value}
                      onSelect={() => setPaymentType(opt.value)}
                      icon={opt.icon}
                      label={PAYMENT_TYPE_LABELS[opt.value]}
                      hint={opt.hint}
                    />
                  ))}
                </div>
              </div>
            )}
            {!isTransfer && (
              <div className={cn(PRODUCT_SHEET_SECTION, "space-y-3")}>
                <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                  Classificação
                </p>
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
                          onReload={() => loadCategories({ selectDefault: false })}
                        />
                        <p className="text-xs text-muted-foreground mt-1.5">
                          Busque, escolha ou crie uma categoria sem sair desta
                          tela.
                        </p>
                      </div>
                    ) : null}
                    <BoletoCategoryRateioFields
                      companyId={companyId}
                      categories={companyCategories}
                      loading={categoriesLoading}
                      onReload={() => loadCategories({ selectDefault: false })}
                      categoryNatureza={categoryNatureza}
                      totalAmount={Number.isFinite(amountNum) ? amountNum : 0}
                      enabled={rateioEnabled}
                      onEnabledChange={(next) => {
                        setRateioEnabled(next);
                        if (next) {
                          setProductsEnabled(false);
                          setProductLines([emptyPayableProductLine()]);
                          setGenerateRecebimento(false);
                          setRateioLines(initialRateioLines(companyCategoryId));
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
                    />
                  </>
                ) : (
                  <>
                    <div>
                      <Label>
                        {expenseId
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
                        onReload={() => loadCategories({ selectDefault: false })}
                        allowClear={Boolean(expenseId)}
                      />
                      <p className="text-xs text-muted-foreground mt-1.5">
                        {expenseId
                          ? "Usada nas linhas da nota sem categoria. O DRE rateia pelos itens classificados."
                          : "Busque, escolha ou crie uma categoria sem sair desta tela."}
                      </p>
                    </div>
                  </>
                )}
                {allowProducts ? (
                  <PayableProductDraftFields
                    enabled={productsEnabled}
                    onEnabledChange={(next) => {
                      setProductsEnabled(next);
                      if (next) {
                        setRateioEnabled(false);
                        setProductLines((prev) =>
                          prev.length > 0 ? prev : [emptyPayableProductLine()],
                        );
                      } else {
                        setProductLines([emptyPayableProductLine()]);
                        setGenerateRecebimento(false);
                      }
                    }}
                    lines={productLines}
                    onLinesChange={setProductLines}
                    products={catalogProducts}
                    generateRecebimento={generateRecebimento}
                    onGenerateRecebimentoChange={setGenerateRecebimento}
                    hasLinkedProduct={hasLinkedProduct}
                  />
                ) : null}
              </div>
            )}
            {expenseId && expenseItems.length > 0 ? (
              <ExpenseItemsInlineTable
                items={expenseItems}
                canEdit
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
            {requiresPaymentDetails && !expenseId && (
              <div className={PRODUCT_SHEET_SECTION}>
                <div className="mb-1 flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-primary" />
                  <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                    Fornecedor
                  </p>
                </div>
                <p className="mb-4 text-sm text-muted-foreground">
                  Opcional. Se escolher um cadastro com PIX ou TED, preenchemos
                  o pagamento.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <div className="min-w-0 flex-1">
                    <SearchSelect
                      value={supplierId === "__create__" ? "" : supplierId}
                      onValueChange={handleSupplierChange}
                      onSearchChange={(query) => {
                        setSupplierSearchQuery(query);
                        if (query.trim()) supplierSearchQueryRef.current = query;
                      }}
                      options={supplierSelectOptions}
                      trailingOptions={[
                        {
                          value: "__create__",
                          label: "Criar fornecedor",
                          accent: true,
                        },
                      ]}
                      placeholder="Buscar pelo nome ou CNPJ"
                      searchPlaceholder="Nome, CNPJ ou CPF…"
                      emptyMessage="Nenhum fornecedor encontrado."
                      triggerClassName="h-11 rounded-xl border-border bg-background shadow-sm"
                      contentClassName={SEARCH_SELECT_WIDE_POPOVER_CLASS}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 shrink-0 rounded-xl"
                    onClick={openCreateSupplier}
                  >
                    <Plus className="h-4 w-4" />
                    Novo
                  </Button>
                </div>
              </div>
            )}

          <div className={PRODUCT_SHEET_SECTION}>
            <p className="mb-4 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
              Valores e datas
            </p>
            <div>
              <Label>Descrição</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={
                  isTransfer
                    ? "Ex: Transferência para reserva"
                    : "Ex: Pagamento energia - Jan/2025"
                }
                className={PRODUCT_SHEET_INPUT}
              />
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Emissão</Label>
                <Input
                  type="date"
                  value={emissionDate}
                  onChange={(e) => setEmissionDate(e.target.value)}
                  className={PRODUCT_SHEET_INPUT}
                />
              </div>
              <div>
                <Label>Vencimento</Label>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className={PRODUCT_SHEET_INPUT}
                />
              </div>
            </div>
            <div className="mt-4">
              <Label>Valor (R$)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0,00"
                className={PRODUCT_SHEET_INPUT}
              />
            </div>
          </div>

          {requiresPaymentDetails && paymentType === "boleto" && (
            <div className={PRODUCT_SHEET_SECTION}>
              <p className="mb-4 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                Dados do boleto
              </p>
              <Label>Código de barras</Label>
              <Input
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="Opcional"
                className={PRODUCT_SHEET_INPUT}
              />
            </div>
          )}

          {requiresPaymentDetails && paymentType === "pix" && (
            <div className={PRODUCT_SHEET_SECTION}>
              <p className="mb-4 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                Chave PIX
              </p>
              <div className="flex flex-col gap-4 sm:flex-row">
                <div className="sm:w-44">
                  <Label className="text-xs">Tipo da chave</Label>
                  <Select value={pixKeyType} onValueChange={setPixKeyType}>
                    <SelectTrigger className={PRODUCT_SHEET_SELECT}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
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
                    placeholder={
                      pixKeyType === "cpf"
                        ? "000.000.000-00"
                        : pixKeyType === "cnpj"
                          ? "00.000.000/0001-00"
                          : pixKeyType === "phone"
                            ? "(11) 99999-9999"
                            : "Informe a chave"
                    }
                    className={PRODUCT_SHEET_INPUT}
                  />
                </div>
              </div>
            </div>
          )}

          {requiresPaymentDetails && paymentType === "ted" && (
            <div className={PRODUCT_SHEET_SECTION}>
              <p className="mb-4 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                Dados bancários
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label className="text-xs">Banco</Label>
                  <Input
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    placeholder="Nome do banco"
                    className={PRODUCT_SHEET_INPUT}
                  />
                </div>
                <div>
                  <Label className="text-xs">Código</Label>
                  <Input
                    value={bankCode}
                    onChange={(e) => setBankCode(e.target.value)}
                    placeholder="001"
                    className={PRODUCT_SHEET_INPUT}
                  />
                </div>
                <div>
                  <Label className="text-xs">Agência</Label>
                  <Input
                    value={agency}
                    onChange={(e) => setAgency(e.target.value)}
                    placeholder="0000"
                    className={PRODUCT_SHEET_INPUT}
                  />
                </div>
                <div>
                  <Label className="text-xs">Conta</Label>
                  <Input
                    value={account}
                    onChange={(e) => setAccount(e.target.value)}
                    placeholder="00000-0"
                    className={PRODUCT_SHEET_INPUT}
                  />
                </div>
              </div>
              <div className="mt-4">
                <Label className="text-xs">Tipo de conta</Label>
                <Select value={accountType} onValueChange={setAccountType}>
                  <SelectTrigger className={PRODUCT_SHEET_SELECT}>
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
              <div className="mt-4">
                <Label className="text-xs">Beneficiário (opcional)</Label>
                <Input
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  placeholder="Nome do favorecido"
                  className={PRODUCT_SHEET_INPUT}
                />
              </div>
            </div>
          )}
            </div>
          </div>

          <SheetFooter className="shrink-0 flex-col gap-2 border-t border-border bg-card px-6 py-4 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={!canSubmit || loading}
              className="w-full sm:w-auto"
            >
              {loading
                ? "Cadastrando..."
                : isTransfer
                  ? "Cadastrar transferência"
                  : "Cadastrar"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
      <CreateSupplierSheet
        open={createSupplierOpen}
        onOpenChange={(next) => {
          setCreateSupplierOpen(next);
          if (!next) {
            setSupplierCreateDocument("");
            supplierSearchQueryRef.current = "";
          }
        }}
        companyId={companyId}
        initialDocument={supplierCreateDocument}
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
          applySupplierSelection(mapped, mapped.id);
        }}
      />
      <CreateBankAccountSheet
        open={createBankOpen}
        onOpenChange={setCreateBankOpen}
        companyId={companyId}
        onSuccess={(account) => {
          setBankAccounts((prev) =>
            [...prev.filter((a) => a.id !== account.id), account].sort((a, b) =>
              a.name.localeCompare(b.name, "pt-BR"),
            ),
          );
          if (createBankTarget === "origin") {
            setOriginBankAccountId(account.id);
          } else {
            setDestBankAccountId(account.id);
          }
        }}
      />
    </Sheet>
  );
}
