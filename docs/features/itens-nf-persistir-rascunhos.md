# Feature: Persistir rascunhos dos itens da NF e salvar todas

- **Slug:** `itens-nf-persistir-rascunhos`
- **Status:** feita
- **Área:** `/app/contas-a-pagar` · Editar conta · itens da nota

## Problema

Ao salvar um item da nota, a lista recarrega e as categorias (e outros campos) ainda não salvos nas outras linhas somem.

## Objetivo

Alterações não salvas nas outras linhas permanecem após salvar uma. Dá para salvar todas as linhas alteradas de uma vez.

## Fora de escopo

- Autosave por campo.
- Desfazer após salvar.

## Contexto no código

- `web/src/components/expenses/ExpenseItemsInlineTable.tsx`
- `web/src/lib/saveExpenseItemLinkEdit.ts`
- Usado em `EditBoletoSheet`, `CreateBoletoSheet`, `ExpenseDetailSheet`

## Comportamento esperado

- Após salvar uma linha, drafts sujos das demais linhas ficam.
- Botão «Salvar todas» nas linhas com alteração válida.
- Confirmação única no salvar todas; toast com sucesso/erro.

## Critérios de aceite

- [x] Preencher categorias em 2+ linhas; salvar uma; as outras mantêm o valor
- [x] «Salvar todas» grava todas as sujas e limpa o estado dirty
- [ ] Verificar no browser o fluxo principal

## Notas para a IA

Não fazer `setRows({})` no reload de `items` com os mesmos ids. Preservar se `isExpenseItemDraftDirty`.
