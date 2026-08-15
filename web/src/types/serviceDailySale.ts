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

/** Líquido da venda de serviço = total bruto (Vl.Bruto). Taxa é sempre 0 por ora. */
export function serviceDailySaleDisplayAmount(
  row: Pick<ServiceDailySaleCalendarRow, "gross_value" | "allocation">,
): number {
  void row.allocation;
  return Number(row.gross_value) || 0;
}

export function serviceDailySaleTitle(
  row: ServiceDailySaleCalendarRow,
): string {
  const name = row.service?.name?.trim();
  const code = row.service?.code?.trim();
  if (name && code) return `${name} (${code})`;
  if (name) return name;
  if (code) return `Serviço ${code}`;
  return "Venda de serviço";
}
