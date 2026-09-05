# Feature: Variante — cadastrar agrupamento novo

- **Slug:** `correlacao-variante-criar-agrupamento`
- **Status:** pronto
- **Área:** `/app/produtos` (Correlação · Para corrigir)

## Problema

Em «Variante de um agrupamento», o seletor só lista produtos já cadastrados. Se o agrupamento não existe (ex. «Bolinho» ainda não está no cadastro), o fluxo trava: empty state e botão Ligar desabilitado.

## Objetivo

Dá para informar o nome de um agrupamento novo, criá-lo e ligar o item como variante, sem sair da correlação.

## Fora de escopo

- Formulário completo do agrupamento (SKU, categorias).
- Inferir o nome do agrupamento a partir da variante.
- Mudar o detalhe do produto ou a lista `/app/produtos/familias`.

## Contexto no código

- `web/src/components/products/ProductSetupActionPanel.tsx`
- `web/src/components/products/ProductValidationCards.tsx` (papel variante no card de confirmação)
- `web/src/lib/createCatalogProduct.ts`
- `web/src/lib/productSaleFamily.ts` — `linkSaleFamilyVariant` já promove o destino
- `web/src/lib/outputProductDraft.ts` — `matchProductByTypedName`

## Comportamento esperado

- Continua dando para buscar um agrupamento ou produto existente (produto existente vira agrupamento ao ligar).
- Nome novo: campo ou opção «Cadastrar «nome» como agrupamento».
- Nome igual a um cadastro existente não cria duplicata — usa esse cadastro.
- Ao confirmar, cria o agrupamento (cadastro mínimo) e liga a variante. O agrupamento não tem estoque; a variante continua sendo o produto.

## Critérios de aceite

- [x] Com lista vazia, dá para cadastrar o agrupamento pelo nome e ligar a variante.
- [x] Com busca sem resultado, a opção de cadastrar o nome digitado aparece.
- [x] Nome igual a um produto/agrupamento existente não cria outro cadastro.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Reutilizar `createCatalogProduct` + `linkSaleFamilyVariant` (o RPC promove o destino). Não abrir `CreateProductSheet`. Sanitizar o nome com `sanitizeCatalogProductName`.
