# Feature: Detalhe do produto — agrupamento e layout

- **Slug:** `produto-detalhe-configuracao`
- **Status:** feita
- **Área:** `/app/produtos` · sheet de detalhe do item
- **Continua:** `epoc-familia-venda-operacional.md`

## Problema

No detalhe, “família” e as ações (tornar, vincular, ficha, unificar) ficam espalhadas no header e em cards separados. Não dá para marcar que o item **não** é agrupamento. O layout empilha identificação, estoque e status sem necessidade.

## Objetivo

No detalhe do produto, o nome visível é **agrupamento**. As ações de configurar o item (tornar agrupamento, vincular, ficha técnica, unificar, não é agrupamento) ficam no **mesmo card**. Identificação à esquerda; estoque e valor em 2×2 à direita. Status no header, abaixo das categorias.

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
- Card **Configuração** com as ações: tornar agrupamento, vincular a um agrupamento, é ficha técnica, unificar com outro, e **não é um item de agrupamento**.
- “Não é agrupamento” grava flag; some a tag **Possível agrupamento**; o próximo sync não a traz de volta.
- Quem já é agrupamento pode deixar de ser (variantes desvinculam).
- Header: só **Editar**. Status (ativo/inativo) abaixo de Categorias de produto.
- Grid: identificação à esquerda; quantidade, mínimo, último preço e valor em estoque em 2×2 à direita.

## Critérios de aceite

- [x] Detalhe usa “agrupamento”, não “família”.
- [x] As quatro ações de configuração + “não é agrupamento” estão no mesmo card.
- [x] Marcar “não é agrupamento” some a tag e persiste após recarregar.
- [x] Sem card Status; ativo/inativo no header abaixo das categorias.
- [x] Identificação à esquerda; estoque/valor em 2×2 à direita (`md+`).
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

- Coluna `products.not_sale_grouping`. Código interno pode continuar `sale_family`.
- Não confundir com categoria financeira (`is_grouping`).
- Ficha técnica e unificar só mudam de lugar; o comportamento é o mesmo.
