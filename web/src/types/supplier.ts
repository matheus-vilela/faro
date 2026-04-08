export interface Supplier {
  id: string;
  company_id: string;
  name: string;
  document: string | null;
  email: string | null;
  phone: string | null;
  /** Nome do vendedor / contato comercial */
  sales_contact_name?: string | null;
  /** WhatsApp do contato comercial */
  sales_whatsapp?: string | null;
  /** Nome do gerente comercial */
  commercial_manager?: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  payment_info?: SupplierPaymentInfo | null;
}

export interface SupplierPaymentInfo {
  id: string;
  supplier_id: string;
  bank_name: string | null;
  bank_code: string | null;
  agency: string | null;
  account: string | null;
  account_type: "conta_corrente" | "poupanca" | null;
  pix_key: string | null;
  pix_type: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupplierUpdateToken {
  id: string;
  supplier_id: string;
  token: string;
  used_at: string | null;
  expires_at: string;
  created_at: string;
}
