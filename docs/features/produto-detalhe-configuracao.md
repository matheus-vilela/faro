# Feature: Detalhe do produto — agrupamento e layout

- **Slug:** `produto-detalhe-configuracao`
- **Status:** feita
- **Área:** `/app/produtos` · sheet de detalhe do item
- **Continua:** `epoc-familia-venda-operacional.md`

## Problema

No detalhe, “família” e as ações (tornar, vincular, ficha, unificar) ficam espalhadas no header e em cards separados. Não dá para marcar que o item **não** é agrupamento. O layout empilha identificação, estoque e status sem necessidade.

## Objetivo

No detalhe do produto, o nome visível é **agrupamento**. As ações de configurar o item (tornar agrupamento, vincular, ficha técnica, unificar, não é agrupamento) ficam no **mesmo card**. Status no header, abaixo das categorias.

Aba **Resumo**: identificação e estoque/valor em dois cards lado a lado; configuração em card próprio; lotes, conversões, unificação e fichas abaixo, sem tiles soltos.

## Fora de escopo

- Renomear a rota `/app/produtos/familias` ou as RPCs (`sale_family`).
- Transformar agrupamento em ficha.
- Inferir agrupamento sozinho.
- Card Status no resumo.

## Contexto no código

- `web/src/pages/Produtos.tsx` — sheet de resumo
- `web/src/components/products/ProductSaleFamilySection.tsx`
- `web/src/components/products/ProductIdentificationSummary.tsx`
- `web/src/lib/productSaleFamily.ts`

## Comportamento esperado

- Copy no detalhe e na listagem do catálogo: **Agrupamento** / **Possível agrupamento** (não “família”).
- Card **Configuração**: três seletores — **Agrupamento**, **Ficha técnica**, **Unificar com**. Agrupamento = nenhum / este é o agrupamento / ligar a um existente. Ficha abre o editor. Unificar abre o diálogo com o produto escolhido.
- “Não é agrupamento” grava flag; some a tag **Possível agrupamento**; o próximo sync não a traz de volta.
- Quem já é agrupamento pode deixar de ser (variantes desvinculam).
- Header: só **Editar**. Status (ativo/inativo) abaixo de Categorias de produto.
- Grid: identificação à esquerda; quantidade, mínimo, último preço e valor em estoque em 2×2 à direita.

## Critérios de aceite

- [x] Detalhe usa “agrupamento”, não “família”.
- [x] Configuração no resumo: três seletores (agrupamento, ficha, unificar).
- [x] Marcar “não é agrupamento” some a tag e persiste após recarregar.
- [x] Sem card Status; ativo/inativo no header abaixo das categorias.
- [x] Identificação e estoque/valor em dois cards lado a lado (`lg+`).
- [x] Aba Resumo extraída em `ProductDetailSummary` + cards próprios.
- [x] Item ligado a um agrupamento continua produto (ficha, unificar, estoque). O vínculo é extra, não um tipo exclusivo.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

- Coluna `products.not_sale_grouping`. Código interno pode continuar `sale_family`.
- Não confundir com categoria financeira (`is_grouping`).
- Ficha técnica e unificar só mudam de lugar; o comportamento é o mesmo.
- Variante = produto + vínculo. Não tratar “variante” como papel que substitui o produto.
