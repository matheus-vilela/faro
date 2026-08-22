export interface Product {
  id: string
  company_id: string
  name: string
  sku: string | null
  unit: string
  min_quantity: number
  current_quantity: number
  /** Último valor pago por unidade de cadastro/referência (mantido para exibição). */
  last_unit_value: number | null
  /** Unidade de referência do último valor pago (ex.: un). */
  last_unit_value_unit_code?: string | null
  /** Último valor pago convertido para unidade de estoque atual (uso interno de cálculo). */
  last_unit_value_stock?: number | null
  /** Legado; CMV na venda usa a folha CMV padrão da empresa. */
  cmv_category_id?: string | null
  /** Última categoria financeira de compra; pré-preenche novas linhas de NF. */
  default_expense_category_id?: string | null
  /** Se true, vendas geram lançamento de CMV; se false, não compõe CMV no DRE. */
  composes_cmv?: boolean
  /** Custo médio ponderado (CMV), quando houver entradas valoradas */
  average_cost?: number | null
  /** Código para etiqueta (EAN/Code128) */
  barcode?: string | null
  /** EAN/GTIN da NF-e ou cadastro (quando distinto de `barcode`). */
  ean?: string | null
  is_active?: boolean
  /** false = prato de ficha técnica (oculto na listagem de Produtos). */
  listed_in_product_catalog?: boolean
  created_at: string
  updated_at: string
  /** Colunas geradas (migração stock alert) — opcionais até o banco atualizar */
  stock_is_zero?: boolean
  stock_below_min_positive?: boolean
  stock_below_min_inclusive?: boolean
  stock_has_alert?: boolean
  /** Unidade trazida do XML quando não mapeada de forma confiável para o catálogo. */
  import_unit_raw?: string | null
  /** Sinaliza produto com unidade legada/desconhecida criada via importação. */
  import_unit_needs_review?: boolean
  /** Conversões entre unidade de estoque e unidades secundárias (JSON no produto). */
  unit_conversions?: unknown
  /** Nomes de produtos unificados neste cadastro (importação automática). */
  merged_catalog_names?: string[]
  /** Histórico de unificações (auditoria / undo). */
  merge_audit?: unknown
  ncm?: string | null
  cfop?: string | null
  csosn?: string | null
  canonical_name?: string | null
  /** Legado; preferir stock_lots. */
  expiry_date?: string | null
  /** Lotes com validade: [{ id, quantity, expiry_date, stock_movement_id?, created_at? }]. */
  stock_lots?: unknown
}
