export type BankAccountType = "corrente" | "poupanca" | "outro";

export interface CompanyBankAccount {
  id: string;
  company_id: string;
  name: string;
  tipo: BankAccountType;
  created_at: string;
  updated_at: string;
}

export const BANK_ACCOUNT_TYPE_OPTIONS = [
  { value: "corrente", label: "Corrente" },
  { value: "poupanca", label: "Poupança" },
  { value: "outro", label: "Outro" },
] as const;

export function bankAccountTypeLabel(tipo: BankAccountType): string {
  return (
    BANK_ACCOUNT_TYPE_OPTIONS.find((o) => o.value === tipo)?.label ?? tipo
  );
}
