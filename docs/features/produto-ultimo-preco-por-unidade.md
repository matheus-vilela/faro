# Feature: Último preço proporcional por unidade de estoque

- **Slug:** `produto-ultimo-preco-por-unidade`
- **Status:** feita
- **Área:** `/app/produtos` · card Estoque e valor no detalhe

## Problema

O último preço pode estar numa unidade diferente da de estoque (ex. R$ 50/kg, estoque em g). O card só mostra o valor da unidade de compra, sem o equivalente por unidade de estoque.

## Objetivo

Se o último preço não for por unidade de estoque, o card mostra também o preço proporcional por essa unidade, logo abaixo.

## Fora de escopo

- Alterar persistência de `last_unit_value` / `last_unit_value_stock`.
- Mudar o card do catálogo (listagem).

## Contexto no código

- `web/src/components/products/ProductStockValueCard.tsx`
- `web/src/lib/lastPricePerStockUnit.ts`
- `web/src/lib/companyUnits/convert.ts` (`convertUnitPriceForProduct`)

## Comportamento esperado

- Último preço principal: valor + `por {unidade do preço}`.
- Se essa unidade for diferente da de estoque, busca a conversão (ex. 1 cx = 12 un, nos dois sentidos) e divide o preço pela quantidade de estoque em 1 unidade do preço.
- Não usa `last_unit_value_stock` para essa linha.
- Se o preço já for pela unidade de estoque, sem linha extra.
- Sem conversão direta: texto curto + botão **Criar conversão**, que abre o diálogo de nova conversão com a unidade do último preço pré-selecionada.

## Critérios de aceite

- [x] Preço em outra unidade mostra o proporcional por unidade de estoque abaixo.
- [x] Proporção vem da conversão (cx → un), não de `last_unit_value_stock`.
- [x] Preço já por unidade de estoque não duplica a linha.
- [x] Sem conversão: botão abre o fluxo de criar conversão.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Buscar o par de unidades nas conversões do produto (qualquer sentido). kg/g/ml/l do sistema não precisa de cadastro.
