# Feature: Nota WhatsApp aguarda aprovação

- **Slug:** `whatsapp-nota-aguarda-aprovacao`
- **Status:** feita
- **Área:** `/app/notas-recebimento` / webhook WhatsApp / contas a pagar

## Problema

Nota enviada pelo WhatsApp (foto, PDF ou texto) pode aparecer como **já recebida**. Conferência, estoque e título no financeiro disparam antes do OK da gerência/operação. Fatura de NF classificada como conta a pagar também gerava boleto na hora, sem passar pela fila de aprovação.

## Objetivo

Toda nota de mercadoria que entra pelo WhatsApp fica **aguardando aprovação**. Estoque e título no financeiro só depois do OK de quem tem Notas e recebimento (gerência/operação).

## Fora de escopo

- Mudar o atalho de WhatsApp para fatura/conta de consumo (sem NF/romaneio/cupom).
- Aplicar estoque no clique de aprovar (a conferência de mercadoria continua depois do OK).
- Backfill de estoque já lançado em notas antigas.

## Contexto no código

- Páginas / rotas: `web/src/pages/Despesas.tsx`, `web/src/components/expenses/ExpenseDetailSheet.tsx`
- Componentes: `NotasRecebimentoListRow`, fila do dashboard
- Hooks / libs: `web/src/lib/notasRecebimentoListFilters.ts`, `web/src/lib/dashboardHomeActions.ts`
- Backend: `supabase/functions/received-whatsapp-message/whatsappExpenseFlow.ts`, RPC `approve_whatsapp_expense_as_owner`, `confirmar_recebimento`
- Regras Cursor relacionadas: —

## Comportamento esperado

- Importação WhatsApp de NF/cupom/romaneio cria despesa `pending`; não cria recebimento, estoque nem boleto.
- Lista: seção **Aguardando aprovação**, nunca **Já recebidas**.
- Conferência (app, link ou `lista` no WhatsApp) recusa enquanto `pending`.
- Quem tem permissão de Notas e recebimento (não só o dono) aprova. A RPC cria o título a pagar (se ainda não houver) e libera o card de recebimento pendente.
- Estoque entra só na conferência **depois** da aprovação.

## Critérios de aceite

- [x] Foto/PDF de NF pelo WhatsApp aparece em **Aguardando aprovação**, não em **Já recebidas**.
- [x] Não há movimentação de estoque nem boleto vinculado antes do OK.
- [x] Aprovar (gerência/operação) cria o título e libera a conferência; conferir depois disso entra estoque.
- [x] Botão Receber / link de operador / `lista` no WhatsApp não confirmam nota ainda pendente.
- [x] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Reutilizar `approve_whatsapp_expense_as_owner` (expandir quem pode chamar; não criar outra RPC). NF não deve cair em `insertBoletoFromWhatsappCashflow`. Helper de lista: `isWhatsappAwaitingApproval`.
