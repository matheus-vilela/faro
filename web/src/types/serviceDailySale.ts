/** Venda diária de serviço (EPOC) para calendário / listagens. */
export type ServiceDailySaleCalendarRow = {
  id: string;
  sale_date: string;
  quantity: number;
  unit_price: number;
  gross_value: number;
  discount: number;
  surcharge: number;
  allocation: number;
  service?: {
    id: string;
    code: string;
    name: string;
  } | null;
};

/** Valor a exibir: total da venda (col_9 → allocation) quando houver; senão bruto. */
export function serviceDailySaleDisplayAmount(
  row: Pick<ServiceDailySaleCalendarRow, "gross_value" | "allocation">,
): number {
  const total = Number(row.allocation) || 0;
  if (total !== 0) return total;
  return Number(row.gross_value) || 0;
}

export function serviceDailySaleTitle(row: ServiceDailySaleCalendarRow): string {
  const name = row.service?.name?.trim();
  const code = row.service?.code?.trim();
  if (name && code) return `${name} (${code})`;
  if (name) return name;
  if (code) return `Serviço ${code}`;
  return "Venda de serviço";
}
