# Feature: Sidebar na tela de checklists

- **Slug:** `checklist-sidebar`
- **Status:** pronto
- **Área:** `/app/checklists`

## Problema

As seções de checklists (visão geral, histórico, conferência, ranking) são abas horizontais. Em Produtos e estoque (e Vendas realizadas) a navegação entre áreas é uma sidebar.

## Objetivo

A tela de checklists usa a mesma sidebar: vertical no desktop, faixa no celular. Cada seção tem URL própria.

## Fora de escopo

- Mudar o conteúdo das seções.
- Alterar a execução pública (`/checklist/:token`).
- Novo item no menu principal do app.

## Contexto no código

- `web/src/pages/Checklists.tsx`
- `web/src/components/ProdutosEstoqueLayout.tsx`
- `web/src/pages/VendasRealizadasFluxo.tsx`
- `web/src/App.tsx`

## Comportamento esperado

- Sidebar à esquerda (`md:w-56`), itens com ícone + rótulo, ativo com borda/fundo/sombra.
- No celular, os itens ficam em faixa horizontal (mesmo padrão de Produtos).
- Rotas: `/app/checklists`, `/historico`, `/conferencia`, `/ranking`.
- Badge de pendentes continua em Conferência.
- **Novo checklist** permanece no cabeçalho.

## Critérios de aceite

- [x] Abas horizontais somem; a navegação é a sidebar.
- [x] Desktop: coluna à esquerda. Celular: faixa no topo.
- [x] Trocar de seção atualiza a URL e o refresh mantém a seção.
- [x] Conferência mostra o badge se houver pendentes.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Reutilizar as classes de `ProdutosEstoqueLayout` / `VendasRealizadasFluxo`. `NavLink` com `end` só na visão geral.
