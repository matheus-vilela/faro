# Feature: Vendas realizadas no menu Operação

- **Slug:** `vendas-realizadas-menu-operacao`
- **Status:** feita
- **Área:** `/app/vendas-realizadas`

## Problema

Vendas realizadas está no grupo **Financeiro** da sidebar. A tela é rotina operacional (calendário, faturamento, margens), não fluxo de caixa nem DRE.

## Objetivo

O item **Vendas realizadas** aparece no grupo **Operação** da sidebar, não mais em Financeiro.

## Fora de escopo

- Mudar a URL `/app/vendas-realizadas` ou as sub-rotas.
- Alterar permissão `vendas_realizadas`.
- Mover conciliação, fluxo de caixa, DRE ou relatórios.

## Contexto no código

- `web/src/components/AppLayout.tsx` — `NAV_SECTIONS`

## Comportamento esperado

- Em **Operação**, o item fica depois de Checklists e antes de Fornecedores.
- Em **Financeiro**, o item some.
- Clique no item abre `/app/vendas-realizadas` e marca o item como ativo nas sub-rotas.

## Critérios de aceite

- [x] Sidebar: Vendas realizadas só em Operação.
- [x] Financeiro continua com Contas a pagar, Conciliação, Fluxo, DRE e Relatórios.
- [x] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Só reordenar o item em `NAV_SECTIONS`. Não alterar rotas nem links internos.
