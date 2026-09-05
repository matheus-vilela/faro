# Feature: Filtros e tipos em «Para corrigir»

- **Slug:** `correlacao-corrigir-filtros-tipos`
- **Status:** em-andamento
- **Área:** `/app/produtos` (Correlação · Para corrigir)

## Problema

A listagem «Para corrigir» não tem busca nem filtro. Em **O que é**, as opções pararam no tempo: só unificar, ficha e pular. Faltam os papéis que o cadastro já tem — agrupamento, variante, produto intermediário e «é um produto».

## Objetivo

Dá para filtrar a lista e classificar cada item com os tipos atuais de produto, com o painel da direita executando a ação correspondente.

## Fora de escopo

- Inferir sozinho que o item é agrupamento ou intermediário.
- Mudar a fila residual da IA (quem entra em «Para corrigir»).
- Reescrever o card Configuração do detalhe do produto.
- Serviço (`SERVICE`) nesta lista.

## Contexto no código

- Páginas / rotas: `web/src/pages/ProdutosHome.tsx`
- Componentes: `web/src/components/products/ProductSetupInbox.tsx`, `web/src/components/products/ProductSetupActionPanel.tsx`
- Hooks / libs: `web/src/lib/productSetupQueue.ts`, `web/src/lib/productSaleFamily.ts`, `web/src/lib/productIntermediate.ts`
- Backend: RPCs já usadas (`promote_product_to_sale_family`, `link_sale_family_variant`, ficha técnica)
- Regras Cursor relacionadas: `docs/features/produto-detalhe-configuracao.md`, `docs/features/produto-intermediario.md`

## Comportamento esperado

- Filtros acima da lista: busca (nome, SKU, EAN) e origem (Todos, PDV, Nota, Ficha).
- **O que é** no vendido/PDV: unificar, ficha técnica, intermediário, agrupamento, variante de agrupamento, é um produto.
- **O que é** na compra: unificar, insumo de ficha, variante de agrupamento, intermediário, é um produto.
- Painel: ficha/intermediário abre o editor; agrupamento promove; variante pede o agrupamento e liga; unificar e insumo seguem iguais.

## Critérios de aceite

- [x] Busca reduz a lista por nome/SKU/EAN.
- [x] Filtro de origem isola PDV, nota ou ficha.
- [x] Vendidos têm opção «É um agrupamento» e «Variante de um agrupamento».
- [x] Vendidos e compras têm «Produto intermediário».
- [x] Vendidos têm «É um produto» (antes o PDV não deixava pular).
- [x] Confirmar agrupamento ou variante tira o item da fila.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Não misturar ficha com agrupamento. Variante = produto + vínculo, não um `stock_control_type` exclusivo. Reutilizar `promoteProductToSaleFamily`, `linkSaleFamilyVariant` e `EstoqueReceitasPanel` com `technicalSheetKind`.
