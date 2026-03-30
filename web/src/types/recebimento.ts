export interface Recebimento {
  id: string
  expense_id: string
  token: string
  status: 'pending' | 'received'
  /** Membro da empresa (cadastro) associado ao recebimento — referência ao compartilhar. */
  assigned_company_member_id?: string | null
  assigned_member?: { id: string; name: string } | null
  created_at: string
  received_at: string | null
  expenses?: {
    supplier_name: string | null
    display_name: string | null
    invoice_number: string | null
    notes: string | null
    expense_items?: Array<{
      id: string
      product_name: string
      quantity: number
      unit_value: number
    }>
  }
  recebimento_item_status?: Array<{
    expense_item_id: string
    status: 'received' | 'not_received' | 'partial'
    quantity_received?: number | null
  }>
}
