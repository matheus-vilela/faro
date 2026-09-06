# Feature: Ficha compacta na tabela de correlação

- **Slug:** `correlacao-ficha-compacta`
- **Status:** em-andamento
- **Área:** `/app/produtos` (Correlação · coluna Fluxo)

## Problema

O editor de ficha do estoque (`EstoqueReceitasPanel`) é um painel inteiro. Na tabela de correlação ele estoura a linha, e o Salvar fica dentro do editor, não na coluna Ação.

## Objetivo

Cadastrar ficha/produção na terceira coluna com lista de insumos. O botão Salvar ficha fica na quarta coluna.

## Fora de escopo

- Redesenhar o editor de ficha em Estoque.
- Inferir quantidade da receita.
- Unificar ficha com a nota.

## Contexto no código

- `web/src/components/products/ProductSetupActionPanel.tsx`
- `web/src/components/products/correlacao2/CorrelationCaseWorkbench.tsx`
- `web/src/lib/productTechnicalSheet.ts`
- `docs/dominio/produtos.md`

## Comportamento esperado

- Fluxo ficha/produção: lista de insumos (nome, qtde, unidade, remover) + incluir outro.
- Prefill com os pares da IA/nota, se houver. Carrega ficha já existente.
- Quantidade e unidade do insumo usam a unidade de estoque e as conversões cadastradas no item (`ProductUnitPickerWithConversion`).
- Se a unidade desejada não existir, **Nova conversão** abre o diálogo e grava no cadastro do insumo.
- Ação: **Salvar ficha** ou **Salvar produção**. Grava com `saveProductTechnicalSheet` e some da fila.
- Sem o painel grande de Estoque nesta tabela.

## Critérios de aceite

- [x] Terceira coluna não abre o `EstoqueReceitasPanel`.
- [x] Dá para incluir, editar quantidade e remover insumo.
- [x] Salvar ficha está na coluna Ação.
- [x] Unidade do insumo lista estoque + conversões do item.
- [x] Dá para cadastrar conversão nova no próprio seletor.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Não unificar o vendido com a nota. Insumo = produto da nota/catálogo. Reutilizar o RPC da ficha.
