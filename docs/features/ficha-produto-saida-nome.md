# Feature: Produto de saída por nome ou busca

- **Slug:** `ficha-produto-saida-nome`
- **Status:** em-andamento
- **Área:** `/app/produtos/fichas` · editor de ficha técnica

## Problema

No cadastro de ficha normal ou de produção, o produto de saída só aceita um item já cadastrado. Quem está criando a ficha muitas vezes ainda não tem esse produto no catálogo e precisa sair do fluxo para cadastrá-lo.

## Objetivo

No campo de produto de saída (ficha normal e produção), o usuário informa um **nome novo** ou **busca um produto existente**. Nome novo vira cadastro mínimo ao salvar a ficha.

## Fora de escopo

- Formulário completo de produto (SKU, categorias, conversões) neste campo.
- Criar produto ao adicionar insumo (continua o cadastro completo já existente).
- Escolher unidade do produto novo no editor da ficha (usa a unidade padrão `un`).
- Alterar o diálogo de ficha aberto a partir de um produto já existente (`ingredientsOnly`).

## Contexto no código

- `web/src/components/estoque/EstoqueReceitasPanel.tsx` — `ProductPicker` e `saveRecipe`
- `web/src/lib/createCatalogProduct.ts` — cadastro mínimo
- `web/src/lib/outputProductDraft.ts` — casar nome digitado com produto existente
- `web/src/lib/productTechnicalSheet.ts` — `upsert` depois que o produto existe
- `web/src/components/CreateProductSheet.tsx` — SKU e insert de referência

## Comportamento esperado

- O campo busca produtos pelo nome.
- Com texto sem produto equivalente, aparece **Usar «nome»** (Enter confirma).
- Nome equivalente a um cadastro existente seleciona esse produto; não cria duplicata.
- Nome novo fica pendente até salvar; o cadastro usa nome sanitizado, SKU automático e unidade `un`.
- Ficha de produção continua exigindo saída (existente ou nome).
- Ficha normal sem saída e sem nome continua válida.

## Critérios de aceite

- [x] Busca encontra produto já cadastrado e grava o `output_product_id` dele.
- [x] Nome novo (ficha normal ou produção) cria o produto ao salvar e liga a ficha a ele.
- [x] Nome igual a um produto existente não cria outro cadastro.
- [x] Cancelar o sheet sem salvar não cria produto.
- [ ] Verificar no browser: nova ficha com nome inédito; nova ficha buscando existente; produção com nome novo.

## Notas para a IA

- Não abrir o `CreateProductSheet` neste campo.
- Reutilizar `sanitizeCatalogProductName` no insert.
- Depois de criar, seguir o `saveRecipe` atual (RPC se houver saída; insert de receita se não).
