import { BoletoCategoryPicker } from "@/components/BoletoCategoryPicker";
import { Button } from "@/components/ui/button";
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
  buildChildrenMap,
  isLeafCategory,
  isSelectableDespesaLeaf,
  isSelectableReceitaLeaf,
} from "@/lib/companyCategoryLabels";
import { syncCompanyAlerts } from "@/lib/companyAlerts/syncCompanyAlerts";
import { maskCpfCnpj, maskPhone } from "@/lib/masks";
import { supabase } from "@/lib/supabase";
import type { CompanyCategory } from "@/types/category";
import type { Boleto, BoletoFlowType, PaymentType } from "@/types/expense";
import type {
  ExpenseSeriesType,
  RecurrenceFrequency,
} from "@/types/expenseSeries";
import { FileText } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

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

interface CreateBoletoSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  expenseId?: string | null;
  /** YYYY-MM-DD — preenche vencimento ao abrir (ex.: dia clicado no calendário) */
  defaultDueDate?: string | null;
  /** Tipo de lançamento ao abrir sem despesa vinculada (quando não há `fixedAccountFlow`). */
  defaultAccountFlow?: BoletoFlowType;
  /** Fixa o fluxo e oculta o seletor conta a pagar / a receber (ex.: página de Contas a pagar). */
  fixedAccountFlow?: BoletoFlowType;
  onSuccess?: (boleto: Boleto) => void;
}

export function CreateBoletoSheet({
  open,
  onOpenChange,
  companyId,
  expenseId,
  defaultDueDate,
  defaultAccountFlow = "payable",
  fixedAccountFlow,
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

  const [seriesType, setSeriesType] = useState<ExpenseSeriesType>("single");
  const [recurrenceFrequency, setRecurrenceFrequency] =
    useState<RecurrenceFrequency>("monthly");
  const [installmentCount, setInstallmentCount] = useState("12");

  useEffect(() => {
    if (!open) return;
    if (!expenseId) {
      setAccountFlow(fixedAccountFlow ?? defaultAccountFlow);
    }
    setSeriesType("single");
    if (defaultDueDate?.trim()) {
      setDueDate(defaultDueDate.trim().slice(0, 10));
    } else {
      setDueDate("");
    }
  }, [open, defaultDueDate, defaultAccountFlow, fixedAccountFlow, expenseId]);

  const effectiveFlow: BoletoFlowType = expenseId
    ? "payable"
    : (fixedAccountFlow ?? accountFlow);
  const requiresPaymentDetails = effectiveFlow === "payable";
  const categoryNatureza = effectiveFlow === "receivable" ? "RECEITA" : "DESPESA";

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
        const flow = expenseId ? "payable" : (fixedAccountFlow ?? accountFlow);
        setCompanyCategoryId(pickDefaultForFlow(list, flow));
      }
    },
    [companyId, expenseId, accountFlow, fixedAccountFlow, effectiveFlow],
  );

  useEffect(() => {
    if (!open || !companyId) return;
    void loadCategories({ selectDefault: true });
  }, [open, companyId, loadCategories]);

  const canSubmit =
    companyCategoryId.trim() !== "" &&
    !categoriesLoading &&
    description.trim() !== "" &&
    dueDate.trim() !== "" &&
    parseFloat(amount) > 0 &&
    (!requiresPaymentDetails ||
      paymentType === "boleto" ||
      (paymentType === "pix" && pixKey.trim() !== "") ||
      (paymentType === "ted" &&
        bankName.trim() !== "" &&
        agency.trim() !== "" &&
        account.trim() !== ""));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId || !canSubmit) return;
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    let linkedExpenseId = expenseId ?? null;

    if (
      !linkedExpenseId &&
      effectiveFlow === "payable" &&
      seriesType !== "single"
    ) {
      const installments =
        seriesType === "installment" ? parseInt(installmentCount, 10) : null;
      if (seriesType === "installment" && (!installments || installments < 2)) {
        setLoading(false);
        toast.error("Informe pelo menos 2 parcelas.");
        return;
      }
      const { data: expRow, error: expErr } = await supabase
        .from("expenses")
        .insert({
          company_id: companyId,
          created_by: user?.id ?? null,
          type: "recibo",
          display_name: description.trim(),
          status: "approved",
          expense_source: "manual",
          reference_date: dueDate,
          document_total: parseFloat(amount),
          series_type: seriesType,
          recurrence_frequency:
            seriesType === "recurring" ? recurrenceFrequency : null,
          installment_count: installments,
          recurrence_status: seriesType === "recurring" ? "active" : null,
          series_anchor_due_date: dueDate,
        })
        .select("id")
        .single();
      if (expErr) {
        setLoading(false);
        toast.error(expErr.message ?? "Não foi possível criar a série.");
        return;
      }
      linkedExpenseId = expRow.id;
      await supabase.from("expense_items").insert({
        company_id: companyId,
        expense_id: expRow.id,
        product_name: description.trim(),
        quantity: 1,
        unit_value: parseFloat(amount),
        stock_added: false,
      });
    }

    const payload: Record<string, unknown> = {
      company_id: companyId,
      company_category_id: companyCategoryId,
      category: null,
      description: description.trim(),
      due_date: dueDate,
      amount: parseFloat(amount),
      status: "pending",
      flow_type: effectiveFlow,
    };
    if (linkedExpenseId) payload.expense_id = linkedExpenseId;

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
    setDescription("");
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
    onOpenChange(false);
    toast.success("Conta cadastrada com sucesso.");
    void syncCompanyAlerts(companyId);
    onSuccess?.(boleto);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {expenseId
              ? "Novo pagamento"
              : effectiveFlow === "receivable"
                ? "Nova conta a receber"
                : "Nova conta a pagar"}
          </SheetTitle>
          <SheetDescription>
            {expenseId
              ? "Cadastre boleto, PIX ou TED para vincular à despesa"
              : effectiveFlow === "receivable"
                ? "Registre valores a receber (entrada no fluxo de caixa)"
                : "Registre contas a pagar (saída no fluxo de caixa)"}
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="grid gap-4">
            {!expenseId && effectiveFlow === "payable" && (
              <div className="space-y-3 rounded-lg border p-4">
                <Label>Tipo de lançamento</Label>
                <Select
                  value={seriesType}
                  onValueChange={(v) => setSeriesType(v as ExpenseSeriesType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single">Única</SelectItem>
                    <SelectItem value="recurring">Recorrente</SelectItem>
                    <SelectItem value="installment">Parcelada</SelectItem>
                  </SelectContent>
                </Select>
                {seriesType === "recurring" && (
                  <div className="space-y-2">
                    <Label>Recorrência</Label>
                    <Select
                      value={recurrenceFrequency}
                      onValueChange={(v) =>
                        setRecurrenceFrequency(v as RecurrenceFrequency)
                      }
                    >
                      <SelectTrigger>
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
                    Define de quanto em quanto tempo esta despesa será repetida automaticamente.
                    </p>
                  </div>
                )}
                {seriesType === "installment" && (
                  <div className="space-y-2">
                    <Label htmlFor="installment-count">Número de parcelas</Label>
                    <Input
                      id="installment-count"
                      type="number"
                      min={2}
                      max={360}
                      value={installmentCount}
                      onChange={(e) => setInstallmentCount(e.target.value)}
                    />
                  </div>
                )}
              </div>
            )}
            {requiresPaymentDetails && (
              <div>
                <Label>Forma de pagamento</Label>
                <Select
                  value={paymentType}
                  onValueChange={(v) => setPaymentType(v as PaymentType)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="boleto">
                      {PAYMENT_TYPE_LABELS.boleto}
                    </SelectItem>
                    <SelectItem value="pix">{PAYMENT_TYPE_LABELS.pix}</SelectItem>
                    <SelectItem value="ted">{PAYMENT_TYPE_LABELS.ted}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
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
                Busque, escolha ou crie uma categoria sem sair desta tela.
              </p>
            </div>
          </div>

          <div>
            <Label>Descrição</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex: Pagamento energia - Jan/2025"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Vencimento</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <div>
              <Label>Valor (R$)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0,00"
              />
            </div>
          </div>

          {requiresPaymentDetails && paymentType === "boleto" && (
            <div>
              <Label>Código de barras</Label>
              <Input
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="Opcional"
              />
            </div>
          )}

          {requiresPaymentDetails && paymentType === "pix" && (
            <div className="space-y-4 rounded-lg border p-4">
              <Label>Chave PIX</Label>
              <div className="flex gap-4 ">
                <div>
                  <Label className="text-xs">Tipo da chave</Label>
                  <Select value={pixKeyType} onValueChange={setPixKeyType}>
                    <SelectTrigger>
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
                  />
                </div>
              </div>
            </div>
          )}

          {requiresPaymentDetails && paymentType === "ted" && (
            <div className="space-y-4 rounded-lg border p-4">
              <Label>Dados bancários</Label>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label className="text-xs">Banco</Label>
                  <Input
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    placeholder="Nome do banco"
                  />
                </div>
                <div>
                  <Label className="text-xs">Código</Label>
                  <Input
                    value={bankCode}
                    onChange={(e) => setBankCode(e.target.value)}
                    placeholder="001"
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label className="text-xs">Agência</Label>
                  <Input
                    value={agency}
                    onChange={(e) => setAgency(e.target.value)}
                    placeholder="0000"
                  />
                </div>
                <div>
                  <Label className="text-xs">Conta</Label>
                  <Input
                    value={account}
                    onChange={(e) => setAccount(e.target.value)}
                    placeholder="00000-0"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">Tipo de conta</Label>
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
              <div>
                <Label className="text-xs">Beneficiário (opcional)</Label>
                <Input
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  placeholder="Nome do favorecido"
                />
              </div>
            </div>
          )}

          <SheetFooter>
            <Button type="submit" disabled={!canSubmit || loading}>
              {loading ? "Cadastrando..." : "Cadastrar"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
