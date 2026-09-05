# Feature: Origem PDV/nota e pré-seleção de agrupamento

- **Slug:** `correlacao-corrigir-origem-agrupamento`
- **Status:** pronto
- **Área:** `/app/produtos` (Correlação · Para corrigir)

## Problema

A badge de origem foi parar em Ficha / PDV / Nota fiscal (filtro), e não diz se o item veio da **venda no PDV** ou da **compra na nota**. Itens com tag «Possível agrupamento» exigem escolher o papel à mão e só abrem o painel ao mudar o seletor.

## Objetivo

A badge informa PDV / venda ou Nota fiscal / compra. Se o produto é possível agrupamento, «O que é este item?» já vem em «Faz parte de um agrupamento»; clicar no item abre esse painel.

## Fora de escopo

- Inferir ficha, variante ou unificar.
- Mudar os valores do filtro (Todos / PDV / Nota / Ficha).
- Marcar `stock_only_origin` no sync.

## Contexto no código

- `web/src/components/products/ProductSetupInbox.tsx`
- `web/src/lib/productSetupQueue.ts`
- `web/src/lib/productSetupListFilter.ts`
- `web/src/lib/productSaleFamily.ts` — `isPossibleGroupingProduct`

## Comportamento esperado

- Badge: **PDV / venda** (saída no PDV) ou **Nota fiscal / compra**.
- `stock_only_origin` sem `not_sale_grouping` (e sem ficha/produção/agrupamento já definido) → seletor em **Faz parte de um agrupamento**.
- Clique na linha (ou no card no celular) abre o painel de variante se essa opção estiver pré-selecionada.

## Critérios de aceite

- [x] Badge só distingue PDV / venda e Nota fiscal / compra.
- [x] Possível agrupamento já mostra «Faz parte de um agrupamento» no seletor.
- [x] Clicar no item abre o painel de ligar ao agrupamento.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Reutilizar `isPossibleGroupingProduct`. Não usar o rótulo do filtro («Ficha») na badge.
