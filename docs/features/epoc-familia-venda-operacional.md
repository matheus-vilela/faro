# Feature: Agrupamento no fluxo operacional

- **Slug:** `epoc-familia-venda-operacional`
- **Status:** feita
- **Área:** sync EPOC de **venda de produtos** · lista de vendas do dia
- **Continua:** `epoc-agrupamento-venda-estoque.md`

## Problema

A venda de produtos no EPOC (`mod_rel_produto_sintetico`) não traz as variantes físicas. Elas só estão no estoque do mesmo dia. Se o estoque for uma consulta à parte (tela, extras, loader), o usuário trata como outro fluxo. A listagem de venda fica incompleta.

## Objetivo

**Estoque do dia faz parte da busca de venda de produtos.** Sempre que o Faro buscar venda de produtos no EPOC (onboarding, diário, “Sincronizar neste dia”), busca o estoque **em paralelo**. Com as duas listas, o que só aparece no estoque e ainda não é variante entra na **mesma** listagem de produtos daquele dia, com tipo **Produto** e tag de origem **Somente estoque**, para vincular/criar agrupamento.

Não existe fluxo separado “conferir estoque” na tela de vendas.

## Fora de escopo

- Criar `revenue_entry` / receita para o item só-estoque (não inflar DRE).
- Inferir agrupamento sozinho.
- Recalcular vendas históricas já baixadas no cardápio.
- Transformar agrupamento em ficha.

## Comportamento esperado

### No sync (fonte da verdade)

Em `epoc-sync-csv` (e qualquer outro caminho que puxe venda de produtos):

1. Para cada dia da janela: `mod_rel_produto_sintetico` **e** `mod_rel_estoque` em paralelo.
2. Persistir as saídas de estoque do dia (`epoc_day_stock_outs`).
3. Garantir o cadastro (acha ou cria) e baixar estoque dos itens **só-estoque** como a venda faz no produto (`adjust_product_stock` + movimentação de saída, com a qtde do relatório). Sem `revenue_entry`.
4. Item também na venda (água): não baixar de novo.
5. Import de venda segue como hoje (`create_revenue_entry`).

Serviços/faturamento continuam extras. Estoque **não** é extra — é da venda de produtos.

### Na listagem (só lê o que o sync gravou)

Receitas / “Vendas neste dia” / qualquer lista de produtos do dia:

| Origem | Na lista | Tipo | Coluna origem |
|---|---|---|---|
| Venda | Sim | Produto ou Serviço | — |
| Venda + estoque (água) | Uma linha (a da venda) | Produto | — |
| Só estoque, sem agrupamento | Sim | Produto | **Somente estoque** |
| Só estoque, já vinculado | Não | — | — |

Filtros: tipo (todos / produto / serviço), origem (todas / venda / somente estoque) e busca por nome. Tabela com cabeçalhos ordenáveis (inclui origem). Cards no celular.

No catálogo, ao abrir um produto que só saiu no estoque e ainda não é variante: tag **Possível agrupamento** ao lado de **Categorias de produto**. Água (já vendida), agrupamento, variante ligada e item marcado como **não é agrupamento** não levam a tag.

### Flag no cadastro

Se o identificador (SKU, senão nome) aparece só no estoque:

1. Se o produto **já existe**: gravar `stock_only_origin` (e preencher SKU se estiver vazio).
2. Se **não existe**: criar no catálogo (`listed_in_product_catalog`, `stock_only_origin`) para poder filtrar e vincular. Sem `revenue_entry`.
3. Filtro do catálogo: **Somente estoque**.

A flag some ao vincular como variante ou quando o produto passa a ter venda própria.

Sem chamada ao portal ao abrir o sheet. Sem loader “conferindo estoque”.

## Critérios de aceite

- [x] Sync de venda de produtos busca estoque no mesmo ciclo (paralelo), não num fluxo de UI.
- [x] Abrir o dia **não** dispara consulta nova de estoque no EPOC.
- [x] Só-estoque não vinculado aparece na lista de produtos do dia.
- [x] Já vinculado não aparece. Água uma vez. Totais só da venda.
- [x] Vincular some a linha e não cria receita.
- [x] Tipo da linha só-estoque é **Produto**; a origem vai numa coluna/tag **Somente estoque**.
- [x] Listagem filtra por tipo e origem e ordena pelos cabeçalhos.
- [x] Catálogo: produto só-estoque sem vínculo mostra **Possível agrupamento** ao lado de Categorias de produto.
- [x] Produto já cadastrado cujo SKU/nome aparece só no estoque ganha `stock_only_origin` (e SKU se faltava).
- [x] Se não existir cadastro, o sync cria o produto no catálogo com `stock_only_origin`.
- [x] Só-estoque gera movimentação de saída e atualiza quantidade, como a venda de produto. Sem receita.
- [x] Filtro do catálogo **Somente estoque** lista esses produtos para vincular ao agrupamento.

## Notas para a IA

- Persistir `epoc_day_stock_outs`; a UI lê essa tabela + `revenue_entries` + `product_sale_family_members`.
- Flag no produto: `stock_only_origin`. Sync: `mark_epoc_stock_only_products` (acha/cria) e depois `apply_epoc_stock_variant_outs` (baixa qualquer produto casado, não só variante ligada). Água não baixa duas vezes.
- Não chamar `exportEpocEstoqueDia` a partir de `RevenueDaySalesSheet`.
- Copy da origem na lista do dia: “Somente estoque”. Tipo continua “Produto”.
- No detalhe/catálogo do produto: “agrupamento” / “possível agrupamento” (não “família”).
