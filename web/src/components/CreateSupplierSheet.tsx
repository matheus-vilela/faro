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
import { applyFocusCnpjToSupplier } from "@/lib/applyFocusCnpjToSupplier";
import { isValidCnpj } from "@/lib/cnpj";
import { maskCpfCnpj, maskPhone, unmask } from "@/lib/masks";
import {
  PRODUCT_SHEET_INPUT,
  PRODUCT_SHEET_SELECT,
  PRODUCT_SHEET_SECTION,
} from "@/components/products/productSheetStyles";
import { cn } from "@/lib/utils";
import { consultarCnpjNaFocus } from "@/services/focusConsultaCnpjService";
import { supabase } from "@/lib/supabase";
import type { Supplier } from "@/types/supplier";
import { Building2, CreditCard, Loader2, Plus, Search, UserRound } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

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

interface CreateSupplierSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  /** CNPJ/CPF digitado na busca do seletor (só dígitos ou mascarado). */
  initialDocument?: string;
  onSuccess?: (supplier: Supplier) => void;
}

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

export function CreateSupplierSheet({
  open,
  onOpenChange,
  companyId,
  initialDocument,
  onSuccess,
}: CreateSupplierSheetProps) {
  const [name, setName] = useState("");
  const [document, setDocument] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [salesContactName, setSalesContactName] = useState("");
  const [salesWhatsapp, setSalesWhatsapp] = useState("");
  const [commercialManager, setCommercialManager] = useState("");
  const [notes, setNotes] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankCode, setBankCode] = useState("");
  const [agency, setAgency] = useState("");
  const [account, setAccount] = useState("");
  const [accountType, setAccountType] = useState("conta_corrente");
  const [pixKey, setPixKey] = useState("");
  const [pixType, setPixType] = useState("");
  const [loading, setLoading] = useState(false);
  const [cnpjLoading, setCnpjLoading] = useState(false);
  const lastFetchedCnpjRef = useRef("");
  const lookupInFlightRef = useRef(false);

  const resetForm = useCallback((nextDocument = "") => {
    setName("");
    setDocument(nextDocument);
    setEmail("");
    setPhone("");
    setSalesContactName("");
    setSalesWhatsapp("");
    setCommercialManager("");
    setNotes("");
    setBankName("");
    setBankCode("");
    setAgency("");
    setAccount("");
    setAccountType("conta_corrente");
    setPixKey("");
    setPixType("");
    lastFetchedCnpjRef.current = "";
    lookupInFlightRef.current = false;
    setCnpjLoading(false);
  }, []);

  const findExistingByDocument = useCallback(
    async (digits: string): Promise<Supplier | null> => {
      if (!companyId || (digits.length !== 11 && digits.length !== 14)) {
        return null;
      }
      const { data, error } = await supabase
        .from("suppliers")
        .select("*, supplier_payment_info (*)")
        .eq("company_id", companyId)
        .eq("document", digits)
        .order("created_at", { ascending: true })
        .limit(1);
      if (error) {
        console.error(error);
        return null;
      }
      const row = (data ?? [])[0] as
        | (Supplier & {
            supplier_payment_info?:
              | Supplier["payment_info"]
              | Supplier["payment_info"][];
          })
        | undefined;
      return row ? mapSupplierRow(row) : null;
    },
    [companyId],
  );

  const useExistingSupplier = useCallback(
    (supplier: Supplier) => {
      toast.info("Este documento já está cadastrado. Selecionamos o fornecedor.");
      resetForm();
      onOpenChange(false);
      onSuccess?.(supplier);
    },
    [onOpenChange, onSuccess, resetForm],
  );

  const lookupCnpj = useCallback(
    async (raw: string, opts?: { silent?: boolean }) => {
      const digits = unmask(raw);
      if (digits.length !== 14) {
        if (!opts?.silent) {
          toast.error("Informe um CNPJ com 14 dígitos para buscar os dados.");
        }
        return;
      }
      if (!isValidCnpj(digits)) {
        if (!opts?.silent) toast.error("CNPJ inválido. Confira os dígitos.");
        return;
      }
      if (lastFetchedCnpjRef.current === digits || lookupInFlightRef.current) {
        return;
      }

      const existing = await findExistingByDocument(digits);
      if (existing) {
        useExistingSupplier(existing);
        return;
      }

      lookupInFlightRef.current = true;
      setCnpjLoading(true);
      try {
        const res = await consultarCnpjNaFocus(digits);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        const applied = applyFocusCnpjToSupplier(res.data);
        if (!applied) {
          toast.error("Não foi possível ler os dados deste CNPJ.");
          return;
        }
        lastFetchedCnpjRef.current = applied.document;
        setDocument(maskCpfCnpj(applied.document));
        setName(applied.name);
        if (applied.email) setEmail(applied.email);
        if (applied.phone) setPhone(maskPhone(applied.phone));
        toast.success("Dados do fornecedor preenchidos.");
      } finally {
        lookupInFlightRef.current = false;
        setCnpjLoading(false);
      }
    },
    [findExistingByDocument, useExistingSupplier],
  );

  useEffect(() => {
    if (!open) return;
    const nextDoc = initialDocument?.trim()
      ? maskCpfCnpj(initialDocument)
      : "";
    resetForm(nextDoc);
    const digits = unmask(nextDoc);
    if (isValidCnpj(digits)) {
      void lookupCnpj(digits, { silent: true });
    }
    // Reset only when the sheet opens; initialDocument is read from this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const hasPaymentInfo =
    bankName.trim() ||
    bankCode.trim() ||
    agency.trim() ||
    account.trim() ||
    pixKey.trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId || !name.trim()) return;
    const digits = unmask(document);
    if (digits.length === 11 || digits.length === 14) {
      const existing = await findExistingByDocument(digits);
      if (existing) {
        useExistingSupplier(existing);
        return;
      }
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("suppliers")
      .insert({
        company_id: companyId,
        name: name.trim(),
        document: digits || null,
        email: email.trim() || null,
        phone: phone.trim().replace(/\D/g, "") || null,
        sales_contact_name: salesContactName.trim() || null,
        sales_whatsapp: salesWhatsapp.trim().replace(/\D/g, "") || null,
        commercial_manager: commercialManager.trim() || null,
        notes: notes.trim() || null,
      })
      .select()
      .single();
    setLoading(false);
    if (error) {
      console.error(error);
      toast.error("Não foi possível cadastrar o fornecedor.");
      return;
    }
    const supplier = data as Supplier;
    if (hasPaymentInfo) {
      await supabase.from("supplier_payment_info").upsert(
        {
          company_id: companyId,
          supplier_id: supplier.id,
          bank_name: bankName.trim() || null,
          bank_code: bankCode.trim() || null,
          agency: agency.trim() || null,
          account: account.trim() || null,
          account_type: accountType,
          pix_key: pixKey.trim() || null,
          pix_type: pixType || null,
        },
        { onConflict: "supplier_id" },
      );
    }
    resetForm();
    onOpenChange(false);
    onSuccess?.(supplier);
  };

  const canLookupCnpj = isValidCnpj(document);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex h-full max-h-[100dvh] w-full flex-col gap-0 overflow-hidden border-l border-border bg-background p-0">
        <SheetHeader className="shrink-0 border-b border-border bg-card px-6 pb-5 pt-6 text-left">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-border bg-muted shadow-sm">
              <Building2 className="h-6 w-6 text-primary" />
            </div>
            <div className="min-w-0 flex-1 space-y-1 pr-6">
              <SheetTitle className="text-xl font-semibold sm:text-2xl">
                Novo fornecedor
              </SheetTitle>
              <SheetDescription>
                Informe o CNPJ para preencher o nome automaticamente, ou cadastre
                na mão.
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>
        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 overflow-y-auto bg-muted">
            <div className="space-y-4 p-6">
              <div className={PRODUCT_SHEET_SECTION}>
                <p className="mb-1 text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                  Identificação
                </p>
                <p className="mb-4 text-sm text-muted-foreground">
                  Com CNPJ válido, buscamos razão social na Receita.
                </p>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="supplier-document">CNPJ/CPF</Label>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                      <Input
                        id="supplier-document"
                        value={document}
                        onChange={(e) => {
                          lastFetchedCnpjRef.current = "";
                          setDocument(maskCpfCnpj(e.target.value));
                        }}
                        onBlur={() => {
                          if (canLookupCnpj) void lookupCnpj(document, { silent: true });
                        }}
                        placeholder="00.000.000/0001-00"
                        className={cn(PRODUCT_SHEET_INPUT, "mt-0 flex-1")}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 shrink-0 rounded-xl"
                        disabled={!canLookupCnpj || cnpjLoading}
                        onClick={() => void lookupCnpj(document)}
                      >
                        {cnpjLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Search className="h-4 w-4" />
                        )}
                        {cnpjLoading ? "Buscando..." : "Buscar dados"}
                      </Button>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="supplier-name">Nome *</Label>
                    <Input
                      id="supplier-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Razão social ou nome fantasia"
                      required
                      className={PRODUCT_SHEET_INPUT}
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="supplier-email">E-mail</Label>
                      <Input
                        id="supplier-email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="email@exemplo.com"
                        className={PRODUCT_SHEET_INPUT}
                      />
                    </div>
                    <div>
                      <Label htmlFor="supplier-phone">Telefone</Label>
                      <Input
                        id="supplier-phone"
                        value={phone}
                        onChange={(e) => setPhone(maskPhone(e.target.value))}
                        placeholder="(11) 99999-9999"
                        className={PRODUCT_SHEET_INPUT}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className={PRODUCT_SHEET_SECTION}>
                <div className="mb-1 flex items-center gap-2">
                  <UserRound className="h-4 w-4 text-primary" />
                  <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                    Contato comercial
                  </p>
                </div>
                <p className="mb-4 text-sm text-muted-foreground">
                  Vendedor, WhatsApp e gerente — opcional.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label>Nome do vendedor</Label>
                    <Input
                      value={salesContactName}
                      onChange={(e) => setSalesContactName(e.target.value)}
                      placeholder="Nome do representante"
                      className={PRODUCT_SHEET_INPUT}
                    />
                  </div>
                  <div>
                    <Label>WhatsApp (comercial)</Label>
                    <Input
                      value={salesWhatsapp}
                      onChange={(e) => setSalesWhatsapp(maskPhone(e.target.value))}
                      placeholder="(11) 99999-9999"
                      className={PRODUCT_SHEET_INPUT}
                    />
                  </div>
                </div>
                <div className="mt-4">
                  <Label>Nome do gerente comercial</Label>
                  <Input
                    value={commercialManager}
                    onChange={(e) => setCommercialManager(e.target.value)}
                    placeholder="Nome do gerente"
                    className={PRODUCT_SHEET_INPUT}
                  />
                </div>
                <div className="mt-4">
                  <Label>Observações</Label>
                  <Input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Opcional"
                    className={PRODUCT_SHEET_INPUT}
                  />
                </div>
              </div>

              <div className={PRODUCT_SHEET_SECTION}>
                <div className="mb-1 flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-primary" />
                  <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
                    Meio de pagamento
                  </p>
                </div>
                <p className="mb-4 text-sm text-muted-foreground">
                  Opcional. PIX ou dados bancários para sugerir na conta a pagar.
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
                <div className="mt-4 border-t border-border pt-4">
                  <Label className="text-xs font-medium">PIX</Label>
                  <div className="mt-2 flex flex-col gap-4 sm:flex-row">
                    <div className="sm:w-44">
                      <Label className="text-xs">Tipo da chave</Label>
                      <Select value={pixType} onValueChange={setPixType}>
                        <SelectTrigger className={PRODUCT_SHEET_SELECT}>
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
                        className={PRODUCT_SHEET_INPUT}
                      />
                    </div>
                  </div>
                </div>
              </div>
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
              disabled={!name.trim() || loading}
              className="w-full sm:w-auto"
            >
              <Plus className="h-4 w-4" />
              {loading ? "Cadastrando..." : "Cadastrar fornecedor"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
