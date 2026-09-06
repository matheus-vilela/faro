# Feature: Correlação 2 — unificar com vários produtos

- **Slug:** `correlacao-2-unificar-varios`
- **Status:** em-andamento
- **Área:** `/app/produtos/correlacao-2`

## Problema

«Unificar com produto» só aceita um par. Um vendido pode ter várias compras (fornecedores/EANs); o domínio já pede unificar em sequência.

## Objetivo

No workspace de unificar, o usuário escolhe **vários** produtos. Eles unificam em sequência com o item da fila, pelo diálogo atual (fator de unidade incluso).

## Fora de escopo

- Mudar a RPC `merge_company_products` (continua par a par).
- Unificar ficha ou agrupamento.
- Multi-select em outros papéis (insumo, agrupamento).

## Contexto no código

- `web/src/components/products/ProductSetupActionPanel.tsx`
- `web/src/components/products/ProductMergeDialog.tsx`
- `web/src/lib/mergeProducts.ts`
- `docs/dominio/produtos.md`
- `.cursor/rules/selects.mdc` — multi-valor: SearchSelect + chips

## Comportamento esperado

- SearchSelect adiciona; chips fora listam os escolhidos (remover no chip).
- Já escolhidos saem da lista.
- Vincular abre o diálogo do primeiro; ao concluir, o próximo usa o vencedor, até acabar a fila.
- Compra sem chip ainda pode usar a sugestão (um par).
- Se o agente sugeriu unificar com um produto, esse produto já vem no chip.

## Critérios de aceite

- [x] Dá para marcar dois ou mais produtos e vê-los como chips.
- [x] Vincular unifica todos, em sequência, sem perder o fator de unidade.
- [x] Item some da Correlação 2 só depois do último par.
- [ ] Verificar no browser: um par; dois ou mais pares.

## Notas para a IA

Não inventar picker. Não unificar dose/prato com a garrafa. Hub (`merged_catalog_names`) continua mandando quem permanece.
