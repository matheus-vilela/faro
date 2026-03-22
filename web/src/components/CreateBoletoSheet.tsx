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
import { maskCpfCnpj, maskPhone } from "@/lib/masks";
import { supabase } from "@/lib/supabase";
import type { Boleto, PaymentType } from "@/types/expense";
import { FileText } from "lucide-react";
import { useState } from "react";

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
  onSuccess?: (boleto: Boleto) => void;
}

export function CreateBoletoSheet({
  open,
  onOpenChange,
  companyId,
  expenseId,
  onSuccess,
}: CreateBoletoSheetProps) {
  const [paymentType, setPaymentType] = useState<PaymentType>("boleto");
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

  const canSubmit =
    description.trim() !== "" &&
    dueDate.trim() !== "" &&
    parseFloat(amount) > 0 &&
    (paymentType === "boleto" ||
      (paymentType === "pix" && pixKey.trim() !== "") ||
      (paymentType === "ted" &&
        bankName.trim() !== "" &&
        agency.trim() !== "" &&
        account.trim() !== ""));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId || !canSubmit) return;
    setLoading(true);

    const payload: Record<string, unknown> = {
      company_id: companyId,
      description: description.trim(),
      due_date: dueDate,
      amount: parseFloat(amount),
      payment_type: paymentType,
      status: "pending",
    };
    if (expenseId) payload.expense_id = expenseId;

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

    const { data, error } = await supabase
      .from("boletos")
      .insert(payload)
      .select()
      .single();
    setLoading(false);
    if (error) {
      console.error(error);
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
    onOpenChange(false);
    onSuccess?.(boleto);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Novo pagamento
          </SheetTitle>
          <SheetDescription>
            {expenseId
              ? "Cadastre boleto, PIX ou TED para vincular à despesa"
              : "Cadastre boleto, PIX ou TED para vincular posteriormente"}
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div>
            <Label>Tipo</Label>
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

          {paymentType === "boleto" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Código de barras</Label>
                <Input
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  placeholder="Opcional"
                />
              </div>
              <div>
                <Label>Fornecedor / Banco</Label>
                <Input
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  placeholder="Opcional"
                />
              </div>
            </div>
          )}

          {paymentType === "pix" && (
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

          {paymentType === "ted" && (
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
