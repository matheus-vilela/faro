import type { FluxoBoletosPageConfig } from "@/components/fluxo/FluxoBoletosPage";
import { TrendingDown, TrendingUp, Wallet } from "lucide-react";

export const CONTAS_A_PAGAR_FLUXO_CONFIG: FluxoBoletosPageConfig = {
  flowType: "payable",
  dataSource: "boletos",
  title: "Contas a pagar",
  description: "Saídas previstas com calendário de vencimentos e lista do mês",
  icon: TrendingDown,
  periodDescription: "Calendário e lista usam este mês",
  listTitle: "Contas a pagar",
  listDescription:
    "Saídas agendadas do mês, separadas entre valores prontos para pagamento e valores aguardando recebimento de mercadoria (NF/romaneio)",
  searchPlaceholder: "Filtrar por descrição, fornecedor ou beneficiário...",
  emptyListMessage: "Nenhuma conta a pagar neste mês",
  addButtonLabel: "Adicionar conta a pagar",
  calendarViewMode: "payable",
};

export const CONTAS_A_RECEBER_FLUXO_CONFIG: FluxoBoletosPageConfig = {
  flowType: "receivable",
  dataSource: "boletos",
  title: "Contas a receber",
  description: "Entradas previstas com calendário de vencimentos e lista do mês",
  icon: Wallet,
  periodDescription: "Calendário e lista usam este mês",
  listTitle: "Contas a receber",
  listDescription:
    "Títulos a receber do mês, por categoria, vencimento ou status",
  searchPlaceholder: "Filtrar por descrição...",
  emptyListMessage: "Nenhuma conta a receber neste mês",
  addButtonLabel: "Adicionar conta a receber",
  calendarViewMode: "receivable",
};

export const VENDAS_REALIZADAS_FLUXO_CONFIG: FluxoBoletosPageConfig = {
  flowType: "receivable",
  dataSource: "sales",
  showAddButton: false,
  title: "Vendas realizadas",
  description: "Vendas do período no calendário e na lista do mês",
  icon: TrendingUp,
  periodDescription: "Calendário e lista usam este mês",
  listTitle: "Vendas realizadas",
  listDescription:
    "Tabela do período: agrupe por período ou diário e ordene pelos cabeçalhos",
  searchPlaceholder: "Filtrar por descrição, origem ou serviço...",
  emptyListMessage: "Nenhuma venda realizada neste mês",
  addButtonLabel: "Adicionar entrada",
  calendarViewMode: "receivable",
};
