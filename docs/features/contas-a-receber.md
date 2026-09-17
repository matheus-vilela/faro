# Feature: Contas a receber

- **Slug:** `contas-a-receber`
- **Status:** feita
- **Área:** `/app/contas-a-receber`

## Problema

Não há tela financeira de títulos a receber. O calendário de Vendas realizadas fala em “entradas previstas”, mas lista vendas do PDV; o botão “Adicionar entrada” grava boletos que não aparecem nessa tela.

## Objetivo

O menu Financeiro tem Contas a receber, gêmea de Contas a pagar: calendário e listagem de títulos manuais, cadastro e baixa — separado de Vendas realizadas.

## Fora de escopo

- Cadastro de cliente, NF-e de saída, boleto registrado, planilha, impostos retidos.
- Listar boletos gerados por venda (`revenue_entry_id`) ou transferências.
- Mudar regra de Fluxo de caixa ou DRE.
- Converter pendura/fiado em título a receber.
- Nova chave de permissão.

## Contexto no código

- Páginas / rotas: `web/src/pages/ContasAPagar.tsx`, `web/src/App.tsx`, `web/src/components/AppLayout.tsx`
- Componentes: `FluxoBoletosPage`, `CreateBoletoSheet`, `PayBoletoDialog`, `PayableTotalsCards`
- Hooks / libs: `expenseSeriesApi.ts`, `payableTotals.ts`, `payableListViews.ts`, `contasAPagarPaths.ts`
- Backend: `boletos.flow_type = receivable`
- Regras Cursor: filtros, tabelas e sheets, features

## Comportamento esperado

- Rotas `/app/contas-a-receber` (calendário) e `/listagem`.
- Item Financeiro depois de Contas a pagar; permissão `contas_a_pagar`.
- Só títulos manuais (`flow_type = receivable`, sem `revenue_entry_id`, sem transferência).
- Adicionar: única / recorrente / parcelada (sem transferência).
- Baixa: copy de recebimento (total/parcial).
- Vendas realizadas deixa de criar boleto e de falar em entradas previstas.

## Critérios de aceite

- [x] Menu Financeiro tem Contas a receber; calendário e listagem com URL própria.
- [x] Cadastro manual aparece nas duas seções; baixa marca como recebido.
- [x] Vendas do PDV não entram na tela; Vendas realizadas não cria título a receber.
- [x] Contas a pagar continua igual.
- [x] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Separar `flowType` de `dataSource` (`boletos` | `sales`) em `FluxoBoletosPage`. Não reutilizar o branch de vendas para esta tela.
