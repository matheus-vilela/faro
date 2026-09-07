# Feature: Insumo — consumo só depois da ficha

- **Slug:** `classificar-insumo-consumo-depois`
- **Status:** feita
- **Área:** `/app/produtos` (Classificar · É um insumo)

## Problema

Ao marcar **É um insumo**, o card **Consumo na ficha** (qtde e unidade) aparece junto com o seletor. A pessoa ainda não escolheu se a ficha é técnica ou de produção. O card também é outro visual, não a linha item / qtde / unidade da ficha.

## Objetivo

Primeiro só o seletor da ficha (técnica ou produção). Depois de escolher ou cadastrar, a linha de consumo aparece no padrão da ficha.

## Fora de escopo

- Mudar o seletor de abas (técnica / produção) ou a gravação do vínculo.
- Alterar o card de consumo em Estoque (`EstoqueVincularComprasPanel`).
- Transformar o item da fila em ficha.

## Contexto no código

- `web/src/components/products/ProductSetupActionPanel.tsx`
- `web/src/components/products/CorrelationRecipeIngredientRow.tsx`
- `web/src/components/products/correlacao2/CorrelationCaseWorkbench.tsx`
- `docs/dominio/produtos.md`

## Comportamento esperado

- Em **É um insumo**, a coluna Fluxo começa só com o `SearchSelect` (abas técnica / produção).
- Ao selecionar ficha, converter produto ou cadastrar nome novo, aparece a linha do item com quantidade e unidade — igual à ficha técnica/produção.
- Sem ficha escolhida, o botão de vincular continua desabilitado.
- Quantidade começa vazia.

## Critérios de aceite

- [x] Sem ficha escolhida: só o seletor; sem card Consumo na ficha.
- [x] Depois de escolher ou criar: linha com nome, qtde e unidade.
- [x] Vincular exige ficha + quantidade e unidade válidas.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Reutilizar `CorrelationRecipeIngredientRow`. Não usar `EstoqueRecipeMatchIngredientConfig` nesta coluna. Insumo não é tipo do vendido.
