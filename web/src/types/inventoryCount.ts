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

export type InventoryCountSessionKind = "regular" | "onboarding"

export type InventoryCountSessionStatus =
  | "open"
  | "pending_approval"
  | "returned"
  | "approved"
  | "committed"

export type InventoryCountRecurrenceKind =
  | "once"
  | "every_n_days"
  | "alt_weeks"

export interface InventoryCountSchedule {
  id: string
  company_id: string
  inventory_count_group_id: string | null
  inventory_count_listing_id: string | null
  assigned_company_member_id: string | null
  next_run_at: string
  recurrence_kind: InventoryCountRecurrenceKind
  interval_days: number | null
  weekday: number | null
  active: boolean
  last_run_at: string | null
  created_at: string
  updated_at: string
}

export type OpenInventoryCountSessionResult = {
  ok?: boolean
  error?: string
  session_id?: string
  token?: string
  slug?: string | null
  listing_name?: string | null
  group_name?: string | null
}
