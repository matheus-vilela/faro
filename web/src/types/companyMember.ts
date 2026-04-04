export interface CompanyMember {
  id: string
  company_id: string
  name: string
  phone_normalized: string
  phone_display: string | null
  is_active: boolean
  /** Pode solicitar contagem de estoque pelo WhatsApp (*estoque* / *inventario*) */
  can_inventory_count?: boolean
  created_at: string
  updated_at: string
}
