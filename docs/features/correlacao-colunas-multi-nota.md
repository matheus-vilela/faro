# Feature: Correlação PDV à esquerda, várias notas à direita

- **Slug:** `correlacao-colunas-multi-nota`
- **Status:** em-andamento
- **Área:** `/app/produtos` (Correlação)

## Problema

A lista de confirmar vínculo mostra compra da nota à esquerda e o vendido do PDV à direita. O usuário espera o inverso: item do EPOC/PDV à esquerda e cadastros da nota à direita.

Além disso, o mesmo item vendido pode ter **vários** cadastros de nota (fornecedores diferentes, EAN não identificado). Hoje só dá para escolher um e unificar.

## Objetivo

Na confirmação de mesmo item, a coluna esquerda é o vendido (EPOC/PDV) e a direita lista um ou mais produtos da nota fiscal, com opção de adicionar outros manualmente antes de unificar.

## Fora de escopo

- Mudar o modelo de ficha técnica (insumos já são N na direita).
- Unificar em lote sem revisar fator de unidade (continua o diálogo por par).
- Alterar o contrato da função `correlate-sold-purchased`.
- Reescrever a fila “Para corrigir”.

## Contexto no código

- Páginas / rotas: `web/src/pages/ProdutosHome.tsx`
- Componentes: `web/src/components/products/ProductValidationCards.tsx`, `web/src/components/products/ProductValidationFlow.tsx`
- Hooks / libs: `web/src/lib/productValidation/aiCorrelation.ts`, `web/src/lib/productValidation/session.ts`
- Backend: sem mudança
- Regras Cursor relacionadas: `docs/features/_template.md`

## Comportamento esperado

- Cabeçalho e cards: esquerda = vendido (PDV/EPOC), direita = nota fiscal.
- A IA pode sugerir várias compras no mesmo vendido; todas entram pré-selecionadas se a confiança for alta.
- O usuário remove uma compra ou adiciona outra da fila de notas.
- Uma compra não é sugerida em dois vendidos ao mesmo tempo.
- Unificar percorre as notas selecionadas, uma a uma, com o vendido permanecendo no catálogo.

## Critérios de aceite

- [x] Coluna esquerda mostra o item importado do EPOC/PDV.
- [x] Coluna direita mostra um ou mais itens importados de nota fiscal.
- [x] Dá para adicionar outra compra da nota no mesmo vendido.
- [x] Dá para remover uma compra da lista antes de unificar.
- [x] Confirmar unifica o vendido com todas as notas selecionadas (diálogo em sequência).
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Reutilizar `SearchSelect` e `ProductMergeDialog`. `samePick` passa a ser `string[]` por sugestão. Em `finalizeAiAssignments`, marcar **todas** as compras do same_item como usadas — não só a primeira.
