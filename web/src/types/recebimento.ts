export interface Recebimento {
  id: string
  expense_id: string
  token: string
  status: 'pending' | 'received'
  created_at: string
  received_at: string | null
  expenses?: {
    supplier_name: string | null
    invoice_number: string | null
    notes: string | null
    expense_items?: Array<{
      product_name: string
      quantity: number
      unit_value: number
    }>
  }
}
