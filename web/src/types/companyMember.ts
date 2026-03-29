export interface CompanyMember {
  id: string
  company_id: string
  name: string
  phone_normalized: string
  phone_display: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}
