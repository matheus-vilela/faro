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
import { supabase } from "@/lib/supabase";
import {
  BANK_ACCOUNT_TYPE_OPTIONS,
  type BankAccountType,
  type CompanyBankAccount,
} from "@/types/bankAccount";
import { Landmark } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

function mapSupabaseError(message: string): string {
  if (message.includes("company_bank_accounts_company_name_unique")) {
    return "Já existe uma conta com este nome.";
  }
  return message;
}

interface CreateBankAccountSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  onSuccess?: (account: CompanyBankAccount) => void;
  /** Classe extra no conteúdo (ex.: z-index quando aberto sobre um Dialog). */
  contentClassName?: string;
  /** Classe extra no overlay (ex.: z-index quando aberto sobre um Dialog). */
  overlayClassName?: string;
}

export function CreateBankAccountSheet({
  open,
  onOpenChange,
  companyId,
  onSuccess,
  contentClassName,
  overlayClassName,
}: CreateBankAccountSheetProps) {
  const [name, setName] = useState("");
  const [tipo, setTipo] = useState<BankAccountType>("corrente");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setTipo("corrente");
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyId || !name.trim()) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("company_bank_accounts")
      .insert({
        company_id: companyId,
        name: name.trim(),
        tipo,
      })
      .select()
      .single();
    setLoading(false);
    if (error) {
      toast.error(mapSupabaseError(error.message));
      return;
    }
    onOpenChange(false);
    onSuccess?.(data as CompanyBankAccount);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className={`overflow-y-auto sm:max-w-md ${contentClassName ?? ""}`}
        overlayClassName={overlayClassName}
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Landmark className="h-5 w-5" />
            Nova conta bancária
          </SheetTitle>
          <SheetDescription>
            Cadastre uma conta para usar nos pagamentos.
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div>
            <Label>Nome</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Itaú — conta principal"
              required
            />
          </div>
          <div>
            <Label>Tipo</Label>
            <Select
              value={tipo}
              onValueChange={(v) => setTipo(v as BankAccountType)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BANK_ACCOUNT_TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <SheetFooter>
            <Button type="submit" disabled={loading || !name.trim()}>
              {loading ? "Salvando..." : "Cadastrar conta"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
