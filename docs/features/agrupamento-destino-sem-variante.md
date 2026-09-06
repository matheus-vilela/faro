# Feature: Destino de agrupamento sem variantes

- **Slug:** `agrupamento-destino-sem-variante`
- **Status:** feita
- **Área:** `/app/produtos` · «Faz parte de um agrupamento»

## Problema

Ao escolher o agrupamento de destino, a lista inclui produtos que já são **variante**. Variante não pode virar agrupamento (é SKU com estoque + vínculo). Ligar a uma variante (ou promovê-la) quebra o papel.

## Objetivo

O seletor de destino lista só agrupamento já marcado ou produto que ainda pode virar agrupamento — nunca variante.

## Fora de escopo

- Mudar RPCs de link/promote.
- Tirar variante da lista de «incluir no agrupamento» (`fetchVariantPickerOptions`).

## Contexto no código

- `web/src/lib/productSaleFamily.ts` — `fetchSaleFamilyCandidates`, `fetchLinkedVariantIds`
- `web/src/components/products/ProductSetupCard.tsx`
- `web/src/components/products/SaleFamilyDestinationFields.tsx`
- Domínio: `docs/dominio/produtos.md`

## Comportamento esperado

- «Faz parte de um agrupamento» não mostra produto que já está em `product_sale_family_members` como variante.
- Continua mostrando `SALE_FAMILY` e produto `DIRECT` ainda sem vínculo (pode virar agrupamento ao ligar).
- Ficha e intermediário continuam de fora.

## Critérios de aceite

- [x] `fetchSaleFamilyCandidates` exclui IDs de variante.
- [x] Teste cobre o filtro.
- [ ] Verificar no browser: detalhe → Faz parte de um agrupamento → lista sem variantes.

## Notas para a IA

Reutilizar `fetchLinkedVariantIds`. Não filtrar só no card — o mesmo fetch alimenta correlação e o seletor da fila.
