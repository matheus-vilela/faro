export type ExpenseType = 'nota_fiscal' | 'romaneio' | 'recibo'
export type ExpenseStatus = 'pending' | 'approved' | 'rejected'
export type BoletoStatus = 'pending' | 'paid'

/** Conta a pagar (saída) ou a receber (entrada) no fluxo de caixa. */
export type BoletoFlowType = 'payable' | 'receivable'

/** Conta normal ou transferência entre contas bancárias (fora DRE / simulação de caixa). */
export type BoletoEntryKind = 'standard' | 'transfer'

import type { ExpenseItemProductMergeMeta } from '@/types/productMergeAudit'

export type PendingNewProductConversion = {
  primary_qty: number
  primary_unit_code: string
  secondary_qty: number
  secondary_unit_code: string
}

export type PendingNewProductMeta = {
  name: string
  unit: string
  conversions: PendingNewProductConversion[]
  canonical_name?: string | null
  ncm?: string | null
}

export interface ExpenseItem {
  id?: string
  expense_id?: string
  product_id?: string | null
  stock_added?: boolean
  product_name: string
  quantity: number
  unit_value: number
  invoice_unit?: string | null
  ncm?: string | null
  stock_quantity?: number | null
  import_resolution_status?: string | null
  /** Categoria financeira desta linha (DRE rateia o boleto por estes valores). */
  company_category_id?: string | null
  metadata_json?: {
    product_merge?: ExpenseItemProductMergeMeta
    pending_new_product?: PendingNewProductMeta
  } | null
  products?: { id: string; name: string; current_quantity: number; min_quantity: number; unit?: string } | null
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
  series_type?: 'single' | 'recurring' | 'installment'
  recurrence_frequency?: string | null
  installment_count?: number | null
  recurrence_status?: 'active' | 'inactive' | null
  parent_expense_id?: string | null
  series_anchor_due_date?: string | null
  occurrence_month?: string | null
  scheduled_adjustments?: Array<{
    effective_from: string
    amount?: number
    due_date?: string
  }>
  suppressed_occurrences?: string[]
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
  /**
   * Snapshot da NF-e (ICMSTot) e/ou conferência soma linhas vs total — importação XML / staging.
   * Ver `icms_tot` (vNF, vDesc, vPIS, vCOFINS, …) e opcionalmente `adjusted_sum_components`, `delta`.
   */
  financial_reconciliation_json?: Record<string, unknown> | null
  created_at: string
  updated_at: string
  items?: ExpenseItem[]
  expense_items?: ExpenseItem[]
  total?: number
  boleto?: Boleto | null
  recebimentos?:
    | { id: string; status: string | null }[]
    | { id: string; status: string | null }
    | null
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
  /** standard (padrão) ou transfer (par origem/destino). */
  entry_kind?: BoletoEntryKind
  /** UUID compartilhado pelas duas pernas de uma transferência. */
  transfer_group_id?: string | null
  description: string
  /** Data de emissão do documento/lançamento (YYYY-MM-DD). */
  emission_date?: string
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
  /** Taxas/deduções de receita: só DRE, fora do calendário e do fluxo. */
  exclude_from_fluxo?: boolean
  revenue_entry_id?: string | null
  supplier_id?: string | null
  /** Embed opcional (ex.: conciliação / fluxo). */
  supplier?: { id?: string; name?: string | null } | null
  /** Data em que o pagamento foi realizado (contas quitadas). */
  paid_at?: string | null
  /** Competência do pagamento (primeiro dia do mês, YYYY-MM-01). */
  competence_date?: string | null
  company_bank_account_id?: string | null
  interest_amount?: number
  discount_amount?: number
  /** Valor efetivamente pago (original + juros - desconto). */
  paid_amount?: number | null
  /** Boleto de origem quando este lançamento é o saldo de um pagamento parcial. */
  split_from_boleto_id?: string | null
  created_at: string
  updated_at: string
}

export function isBoletoPayable(b: {
  flow_type?: BoletoFlowType | string | null
}): boolean {
  return b.flow_type !== 'receivable'
}

export function isBoletoTransfer(b: {
  entry_kind?: BoletoEntryKind | string | null
}): boolean {
  return b.entry_kind === 'transfer'
}
