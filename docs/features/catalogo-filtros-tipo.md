# Feature: Filtros do catálogo por tipo

- **Slug:** `catalogo-filtros-tipo`
- **Status:** feita
- **Área:** `/app/produtos` (catálogo)

## Problema

Os filtros do catálogo ficam todos escondidos num painel colapsável, com a busca ocupando a linha inteira. Não dá para pré-filtrar por tipo de cadastro (produto, ficha técnica, agrupamento, produção). No celular o bloco de filtros compete com a lista.

## Objetivo

A barra do catálogo pré-filtra por tipo e, em seguida, categoria e alerta de estoque; o restante fica no botão Filtros. No desktop cabem os seletores da linha; no celular só busca + Filtros.

## Fora de escopo

- Mudar KPIs do catálogo (continuam no universo listado padrão).
- Persistência dos filtros na URL.
- Alterar a tela de fichas técnicas.

## Contexto no código

- Páginas / rotas: `web/src/pages/Produtos.tsx`
- Componentes: `web/src/components/products/ProductCatalogFiltersPanel.tsx`
- Referência visual: `web/src/components/estoque/EstoqueMovimentacoesPanel.tsx` (barra com labels, seletores e Limpar filtros)
- Libs: `web/src/lib/productCatalogFilters.ts`, `web/src/lib/fetchCatalogProductIds.ts`, `web/src/lib/exportProductStockExcel.ts`
- Tipos: `stock_control_type` em `web/src/types/product.ts`

## Comportamento esperado

- Primeiro seletor: **Tipo** — Todos, Ficha técnica, Agrupamento, Possível agrupamento, Produção, Produto.
  - Todos: listados no catálogo ou agrupamento (`SALE_FAMILY`), como hoje.
  - Produto: `DIRECT` / `COMPOSITE` / `SERVICE` (e tipo nulo), listados.
  - Produção: `INTERMEDIATE`.
  - Agrupamento: `SALE_FAMILY`.
  - Possível agrupamento: mesma regra da tag (`stock_only_origin`, ainda sem decisão, sem ficha/produção/agrupamento).
  - Ficha técnica: `RECIPE_CONTROLLED` (inclui os que não entram na listagem padrão).
- Depois: categoria, alerta de estoque, demais (situação, origem, CMV, data) no botão Filtros.
- Busca compacta. Desktop: seletores que couberem na linha; o resto no botão Filtros; Limpar filtros ao lado.
- Mobile: só busca + Filtros (todos os campos dentro).

## Critérios de aceite

- [x] Tipo é o primeiro filtro e altera a lista (ficha técnica aparece só nesse tipo).
- [x] Desktop mostra tipo / categoria / alerta na linha enquanto couber; demais no botão Filtros.
- [x] Mobile mostra só busca e Filtros.
- [x] Limpar filtros zera tipo, busca e os demais.
- [x] Exportação e “selecionar todos” respeitam o tipo.
- [x] Tipo **Possível agrupamento** lista os mesmos itens da tag.

## Notas para a IA

- Não exigir `listed_in_product_catalog` ao filtrar ficha técnica.
- Visual da barra: `rounded-xl border … p-3`, labels `text-xs text-muted-foreground`, `items-end`.
- Sheet de filtros no mobile: não forçar `sm:max-w-*`.
