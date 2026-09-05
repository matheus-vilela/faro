# Feature: Sidebar em contas a pagar

- **Slug:** `contas-a-pagar-sidebar`
- **Status:** feita
- **Área:** `/app/contas-a-pagar`

## Problema

Calendário e listagem de contas a pagar ficam na mesma tela, um abaixo do outro. Em Checklists e Vendas realizadas a navegação entre áreas é uma sidebar.

## Objetivo

Contas a pagar usa a mesma sidebar: Calendário e Listagem, cada uma com URL própria.

## Fora de escopo

- Mudar a lógica de pagamento, totais ou filtros da lista.
- Alterar Vendas realizadas (continua calendário + lista juntos).
- Novo item no menu principal.

## Contexto no código

- `web/src/pages/ContasAPagar.tsx`
- `web/src/components/fluxo/FluxoBoletosPage.tsx`
- Referência: `web/src/pages/Checklists.tsx`, `web/src/pages/VendasRealizadasFluxo.tsx`
- `web/src/App.tsx`

## Comportamento esperado

- Sidebar à esquerda (`md:w-56`): Calendário e Listagem, ícone + rótulo, ativo com borda/fundo/sombra.
- No celular, faixa horizontal (mesmo padrão de Checklists).
- Rotas: `/app/contas-a-pagar` (calendário), `/app/contas-a-pagar/listagem`.
- Período, totais e “Adicionar conta” continuam nas duas seções.
- Trocar de seção não remonta a página (mantém o mês).

## Critérios de aceite

- [x] Abas/empilhamento some; a navegação é a sidebar.
- [x] Desktop: coluna à esquerda. Celular: faixa no topo.
- [x] Trocar de seção atualiza a URL e o refresh mantém a seção.
- [x] Calendário não mostra a listagem; listagem não mostra o calendário.

## Notas para a IA

Reutilizar as classes de `Checklists` / `VendasRealizadasFluxo`. `NavLink` com `end` só no calendário. Prop `section` em `FluxoBoletosPage` (`calendar` | `list`); sem prop, mostra os dois (vendas).
