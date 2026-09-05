# Feature: Infos de agrupamento no detalhe do produto

- **Slug:** `produto-detalhe-agrupamento-info`
- **Status:** em-andamento
- **Área:** `/app/produtos` · sheet de detalhe

## Problema

Quem é agrupamento ou faz parte de um só vê isso no seletor de Configuração. Não aparece o nome do agrupamento, a proporção nem os produtos ligados.

## Objetivo

No detalhe, se o item é agrupamento ou variante, um card mostra as infos do agrupamento.

## Fora de escopo

- Editar variantes neste card (continuar em Configuração / Ligar produtos).
- Mudar a RPC `list_sale_family_for_product`.
- Badge na listagem do catálogo.

## Contexto no código

- `web/src/components/products/ProductDetailSummary.tsx`
- `web/src/components/products/ProductSaleFamilySection.tsx` — texto e lista já existentes, não usados no resumo
- `web/src/lib/productSaleFamily.ts`

## Comportamento esperado

- Agrupamento: explica que a venda não baixa estoque e lista os produtos ligados (nome, SKU, proporção).
- Variante: mostra o agrupamento (nome, SKU) e a proporção deste item; lista os outros produtos do mesmo agrupamento, se houver.
- Sumir quando o item não tem papel de agrupamento.

## Critérios de aceite

- [x] Detalhe de um agrupamento lista os produtos ligados.
- [x] Detalhe de uma variante mostra o agrupamento e a proporção.
- [x] Produto sem vínculo não ganha o card.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Variante não vem com `members` na RPC — buscar de novo com o id do agrupamento. Não duplicar os botões de vincular/desvincular do `ProductSetupCard`.
