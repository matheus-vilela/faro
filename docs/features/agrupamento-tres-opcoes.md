# Feature: Agrupamento em três opções no detalhe

- **Slug:** `agrupamento-tres-opcoes`
- **Status:** em-andamento
- **Área:** `/app/produtos` · card Configuração do detalhe

## Problema

O seletor de agrupamento mistura “nenhum”, “não é”, “este é o agrupamento” e a lista de produtos no mesmo campo. Quem só quer classificar o item não deveria ver dezenas de cadastros antes de dizer se faz parte de um agrupamento.

## Objetivo

No detalhe, Agrupamento começa com três papéis. Só “Faz parte de um agrupamento” pede o produto/agrupamento de destino.

## Fora de escopo

- Mudar RPCs de promote/link (produto escolhido que ainda não é agrupamento continua virando agrupamento ao ligar).
- Alterar a lista de Agrupamentos ou o sheet de variantes.
- Inferir o papel sozinho.

## Contexto no código

- Componentes: `web/src/components/products/ProductSetupCard.tsx`
- Hooks / libs: `web/src/lib/productSaleFamily.ts`
- Regras Cursor relacionadas: `docs/features/produto-detalhe-configuracao.md`

## Comportamento esperado

- Primeiro campo: **Não é agrupamento** · **Este produto é um agrupamento** · **Faz parte de um agrupamento**.
- A terceira opção revela um segundo seletor: produto ou agrupamento de destino.
- Escolher um produto que ainda não é agrupamento promove esse destino ao ligar (fluxo atual).
- Confirmações de promover, deixar de ser agrupamento e sair do vínculo permanecem.

## Critérios de aceite

- [x] O primeiro seletor tem só as três opções, sem lista de produtos.
- [x] O seletor de destino só aparece em “Faz parte de um agrupamento”.
- [x] Ligar a um produto comum ainda o transforma em agrupamento.
- [x] “Não é agrupamento” e “Este produto é um agrupamento” não pedem destino.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Não misturar a lista de famílias no `leadingOptions` do primeiro Select. Reutilizar `linkSaleFamilyVariant` e os AlertDialogs atuais.
