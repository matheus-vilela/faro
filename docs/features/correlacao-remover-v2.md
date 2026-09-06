# Feature: Remover a aba Correlação 2

- **Slug:** `correlacao-remover-v2`
- **Status:** em-andamento
- **Área:** `/app/produtos`

## Problema

Correlação e Correlação 2 são a mesma tabela. A segunda aba e as tabs do grupo só existem por causa do experimento.

## Objetivo

Fica só a Correlação. Sem aba Correlação 2 e sem tabs nesse grupo.

## Fora de escopo

- Apagar o workbench (`CorrelationCaseWorkbench`).
- Tirar as tabs de Estoque (Movimentações / Pedidos) ou Fichas (Fichas / Pendentes).
- Mudar o fluxo de validação.

## Contexto no código

- `web/src/components/ProdutosEstoqueLayout.tsx`
- `web/src/App.tsx`
- `web/src/pages/ProdutosCorrelacao2.tsx`
- `web/src/lib/productStockPaths.ts`

## Comportamento esperado

- Menu Produtos: um item Correlação, sem sub-abas.
- `/app/produtos/correlacao-2` redireciona para `/app/produtos`.
- Página e componentes só da v2 saem do código.

## Critérios de aceite

- [x] Não existe aba nem título Correlação 2.
- [x] No grupo Correlação não aparecem tabs.
- [x] A Correlação em `/app/produtos` continua com a tabela.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

O layout já esconde tabs quando o grupo tem um link. Não remover as tabs dos outros grupos.
