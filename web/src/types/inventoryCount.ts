export interface InventoryCountGroup {
  id: string
  company_id: string
  name: string
  sort_order: number
  created_at: string
}

export interface InventoryCountListing {
  id: string
  company_id: string
  inventory_count_group_id: string
  name: string
  sort_order: number
  assigned_company_member_id: string | null
  created_at: string
}
