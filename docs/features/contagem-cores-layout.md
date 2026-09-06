# Feature: Cores da aba Contagem e Listas

- **Slug:** `contagem-cores-layout`
- **Status:** feita
- **Área:** `/app/produtos/contagem`

## Problema

Aba Contagem e Listas usam fundo/borda `primary` em quase tudo (linhas, grupos, abas). Fica diferente do restante de Produtos e estoque (`border-border`, `bg-card` / `bg-background`).

## Objetivo

Mesma paleta neutra do layout de Produtos. Destaque só no que pede ação (aprovar / onboarding pendente).

## Fora de escopo

- Mudar fluxo de conferir, filtros ou RPCs.
- Recolorir o histórico em tabela.

## Contexto no código

- `web/src/lib/inventoryCount/ui.ts`
- `web/src/components/estoque/EstoqueContagemListasTab.tsx`
- `web/src/components/estoque/EstoqueContagemSummaryCards.tsx`
- `web/src/components/estoque/EstoqueContagemPanel.tsx`
- Referência: `ProdutosEstoqueLayout` (abas) e `Card`

## Comportamento esperado

- Linhas clicáveis e cards de grupo: borda/fundo de card.
- Abas internas iguais às do layout (ativa: `bg-background`, não `primary/10`).
- KPI: card neutro; âmbar só se houver item a aprovar ou onboarding pendente.
- Chip Conferir/Abrir: contorno, não pílula primary em cima de fundo primary.

## Critérios de aceite

- [x] Listas e Aprovar sem wash primary nas linhas/grupos.
- [x] Aba ativa alinhada ao layout de Produtos.
- [ ] Verificar no browser Contagem → Aprovar e Listas.
