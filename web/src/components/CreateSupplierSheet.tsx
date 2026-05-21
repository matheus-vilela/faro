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
import type { Supplier } from "@/types/supplier";
import { Building2, CreditCard, Plus, UserRound } from "lucide-react";
import { useState } from "react";

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
  onSuccess?: (supplier: Supplier) => void;
}

export function CreateSupplierSheet({
  open,
  onOpenChange,
  companyId,
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

  const hasPaymentInfo =
    bankName.trim() ||
    bankCode.trim() ||
    agency.trim() ||
    account.trim() ||
    pixKey.trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId || !name.trim()) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("suppliers")
      .insert({
        company_id: companyId,
        name: name.trim(),
        document: document.trim().replace(/\D/g, "") || null,
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
    setName("");
    setDocument("");
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
    onOpenChange(false);
    onSuccess?.(supplier);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Novo fornecedor
          </SheetTitle>
          <SheetDescription>Dados básicos do fornecedor</SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Nome</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nome do fornecedor"
                required
              />
            </div>
            <div>
              <Label>CNPJ/CPF</Label>
              <Input
                value={document}
                onChange={(e) => setDocument(maskCpfCnpj(e.target.value))}
                placeholder="000.000.000-00 ou 00.000.000/0001-00"
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>E-mail</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@exemplo.com"
              />
            </div>
            <div>
              <Label>Telefone</Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(maskPhone(e.target.value))}
                placeholder="(11) 99999-9999"
              />
            </div>
          </div>

          <div className="border-t pt-4 space-y-4">
            <div className="flex items-center gap-2">
              <UserRound className="h-4 w-4" />
              <Label className="text-base font-medium">Contato comercial</Label>
            </div>
            <p className="text-sm text-muted-foreground">
              Vendedor, WhatsApp e gerente (opcional).
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Nome do vendedor</Label>
                <Input
                  value={salesContactName}
                  onChange={(e) => setSalesContactName(e.target.value)}
                  placeholder="Nome do representante"
                />
              </div>
              <div>
                <Label>WhatsApp (comercial)</Label>
                <Input
                  value={salesWhatsapp}
                  onChange={(e) => setSalesWhatsapp(maskPhone(e.target.value))}
                  placeholder="(11) 99999-9999"
                />
              </div>
            </div>
            <div>
              <Label>Nome do gerente comercial</Label>
              <Input
                value={commercialManager}
                onChange={(e) => setCommercialManager(e.target.value)}
                placeholder="Nome do gerente"
              />
            </div>
          </div>

          <div>
            <Label>Observações</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Opcional"
            />
          </div>

          <div className="border-t pt-4 space-y-4">
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4" />
              <Label className="text-base font-medium">Meio de pagamento</Label>
            </div>
            <p className="text-sm text-muted-foreground">
              Opcional. Informe dados bancários ou PIX para facilitar
              pagamentos.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
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
            <div className="grid gap-2 sm:grid-cols-2">
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
            <div className="border-t pt-4">
              <Label className="text-xs font-medium">PIX</Label>
              <div className="flex gap-2 mt-2 ">
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
            <Button type="submit" disabled={!name.trim() || loading}>
              <Plus className="h-4 w-4 mr-2" />
              {loading ? "Cadastrando..." : "Cadastrar fornecedor"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
