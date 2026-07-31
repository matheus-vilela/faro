import type { FluxoBoletosPageConfig } from "@/components/fluxo/FluxoBoletosPage";
import { TrendingDown, TrendingUp } from "lucide-react";

export const CONTAS_A_PAGAR_FLUXO_CONFIG: FluxoBoletosPageConfig = {
  flowType: "payable",
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

export const VENDAS_REALIZADAS_FLUXO_CONFIG: FluxoBoletosPageConfig = {
  flowType: "receivable",
  title: "Vendas realizadas",
  description: "Entradas previstas com calendário de recebimentos e lista do mês",
  icon: TrendingUp,
  periodDescription: "Calendário e lista usam este mês",
  listTitle: "Vendas realizadas",
  listDescription:
    "Entradas do mês: produtos (receitas/contas a receber) e serviços sincronizados do PDV",
  searchPlaceholder: "Filtrar por descrição, origem ou serviço...",
  emptyListMessage: "Nenhuma venda realizada neste mês",
  addButtonLabel: "Adicionar entrada",
  calendarViewMode: "receivable",
};
