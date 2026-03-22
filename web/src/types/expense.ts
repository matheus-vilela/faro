export type ExpenseType = 'nota_fiscal' | 'romaneio' | 'recibo'
export type ExpenseStatus = 'pending' | 'approved' | 'rejected'
export type BoletoStatus = 'pending' | 'paid'

export interface ExpenseItem {
  id?: string
  product_name: string
  quantity: number
  unit_value: number
}

export interface Expense {
  id: string
  company_id: string
  created_by: string | null
  type: ExpenseType
  supplier_id: string | null
  invoice_number: string | null
  supplier_document: string | null
  supplier_name: string | null
  status: ExpenseStatus
  notes: string | null
  created_at: string
  updated_at: string
  items?: ExpenseItem[]
  expense_items?: ExpenseItem[]
  total?: number
  boleto?: Boleto | null
}

export type PaymentType = 'boleto' | 'pix' | 'ted'

export interface Boleto {
  id: string
  company_id: string
  expense_id: string | null
  description: string
  due_date: string
  amount: number
  payment_type?: PaymentType
  barcode: string | null
  provider: string | null
  pix_key_type: string | null
  pix_key: string | null
  bank_name: string | null
  bank_code: string | null
  agency: string | null
  account: string | null
  account_type: string | null
  status: BoletoStatus
  created_at: string
  updated_at: string
}
