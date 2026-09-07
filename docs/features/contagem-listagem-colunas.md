# Feature: Inverter colunas da listagem de contagem

- **Slug:** `contagem-listagem-colunas`
- **Status:** feita
- **Área:** `/app/produtos/contagem` (sheet da listagem)

## Problema

No sheet de editar/criar listagem, “Nesta lista” fica à esquerda e “Adicionar produtos” à direita. O fluxo natural é escolher no catálogo e depois ver o que já entrou na lista.

## Objetivo

Trocar as colunas de lugar: catálogo à esquerda, itens da lista à direita.

## Fora de escopo

- Mudar busca, persistência ou botões de adicionar/remover.
- Alterar cabeçalho, agenda ou rodapé do sheet.

## Contexto no código

- `web/src/components/estoque/EstoqueContagemListingSheet.tsx`

## Comportamento esperado

- Desktop (`md+`): “Adicionar produtos” na coluna esquerda; “Nesta lista” na direita.
- Mobile (uma coluna): catálogo em cima, lista embaixo.

## Critérios de aceite

- [x] Colunas invertidas no sheet de listagem (criar e editar).
- [ ] Verificar no browser o sheet aberto em Contagem → Listas.

## Notas para a IA

Só inverter a ordem das duas `<section>` no grid. Não reestilizar.
