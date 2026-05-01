export type ExpenseType = 'nota_fiscal' | 'romaneio' | 'recibo'
export type ExpenseStatus = 'pending' | 'approved' | 'rejected'
export type BoletoStatus = 'pending' | 'paid'

/** Conta a pagar (saída) ou a receber (entrada) no fluxo de caixa. */
export type BoletoFlowType = 'payable' | 'receivable'

export interface ExpenseItem {
  id?: string
  product_id?: string | null
  stock_added?: boolean
  product_name: string
  quantity: number
  unit_value: number
  invoice_unit?: string | null
  stock_quantity?: number | null
  products?: { id: string; name: string; current_quantity: number; min_quantity: number } | null
}

/** Origem do lançamento; `whatsapp` aguarda aprovação do proprietário antes do recebimento. */
export type ExpenseSource = 'manual' | 'whatsapp'

export interface Expense {
  id: string
  company_id: string
  created_by: string | null
  type: ExpenseType
  /** manual (app) ou whatsapp — ver fluxo de aprovação */
  expense_source?: ExpenseSource
  /** Remetente WhatsApp (só dígitos E.164), quando `expense_source` = whatsapp */
  whatsapp_sender_phone_normalized?: string | null
  supplier_id: string | null
  invoice_number: string | null
  /** Série fiscal (NF-e / NFC-e) */
  invoice_series?: string | null
  supplier_document: string | null
  supplier_name: string | null
  is_recurring?: boolean
  display_name?: string | null
  status: ExpenseStatus
  notes: string | null
  /** Caminho no bucket `expense-documents` (comprovante). */
  source_document_path?: string | null
  /** YYYY-MM-DD — competência (ex.: emissão NF-e); listagem por mês usa este campo. */
  reference_date?: string | null
  /** Total do documento na importação (comparação com soma das linhas). */
  document_total?: number | null
  /** Motivo indicado quando havia divergência ou revisão na importação. */
  divergence_reason?: string | null
  created_at: string
  updated_at: string
  items?: ExpenseItem[]
  expense_items?: ExpenseItem[]
  total?: number
  boleto?: Boleto | null
}

export type PaymentType = 'boleto' | 'pix' | 'ted'

/** Classificação da conta a pagar (fornecedores vs custo fixo do estabelecimento, etc.). */
export type BoletoCategory =
  | 'insumos'
  | 'fornecedores'
  | 'custo_fixo'
  | 'estabelecimento'
  | 'outros'

export interface Boleto {
  id: string
  company_id: string
  expense_id: string | null
  /** Conta a pagar (padrão legado) ou a receber. */
  flow_type?: BoletoFlowType
  description: string
  due_date: string
  amount: number
  /** Legado (enum fixo); preferir company_category_id. */
  category?: BoletoCategory | null
  /** Categoria ou subcategoria personalizada (company_categories). */
  company_category_id?: string | null
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

export function isBoletoPayable(b: Pick<Boleto, 'flow_type'>): boolean {
  return b.flow_type !== 'receivable'
}
