# Feature: Correlação — configurar o papel do vendido

- **Slug:** `correlacao-configurar-papel`
- **Status:** pronto
- **Área:** `/app/produtos` (Correlação · confirmar vínculo)

## Problema

O card de match alto só oferece Unificar e Ficha técnica. Não dá para dizer que o vendido é agrupamento, variante, ficha de produção ou só um produto. A tela de confirmação é a de configurar o que o item do PDV é — sem isso o fluxo não cobre os casos reais.

## Objetivo

No card de confirmação, a pessoa escolhe o papel do vendido (produto da nota, só produto, ficha, ficha de produção, agrupamento ou variante) e confirma. Unificar só aparece quando o papel é «mesmo produto».

## Fora de escopo

- Inferir o papel sozinho (a IA só sugere; a pessoa confirma).
- Marcar o vendido como «insumo» — insumo é o item da nota quando o vendido é ficha.
- Mudar o contrato da IA `correlate-sold-purchased`.
- Unificar ficha normal ou agrupamento com a nota.

## Contexto no código

- `web/src/components/products/ProductValidationCards.tsx`
- `web/src/components/products/ProductValidationFlow.tsx`
- `web/src/lib/productValidation/soldRole.ts`
- `web/src/lib/productSaleFamily.ts`
- `web/src/components/products/ProductSetupActionPanel.tsx` (ações já existentes)
- `docs/dominio/produtos.md`

## Comportamento esperado

Papéis do **vendido (PDV)**:

| Papel | Ação |
|---|---|
| Pode ser mesmo produto da nota | Unificar com a(s) compra(s). Só produto ↔ produto. |
| É um produto interno | Sai da fila sem unificar. A nota continua pendente. |
| Ficha técnica | Abre ficha de venda; a nota entra como insumo. |
| Ficha de produção | Abre ficha intermediária; a nota entra como insumo da produção. |
| É um agrupamento | Promove o vendido; compras da nota viram variantes. |
| Faz parte de um agrupamento | Liga o vendido a um agrupamento existente. |

Insumo não é opção do vendido. A compra da nota vira insumo quando o papel é ficha.

## Critérios de aceite

- [x] Card de match alto (same_item e recipe) tem seletor de papel com as seis opções.
- [x] Unificar só fica disponível em «Pode ser mesmo produto da nota».
- [x] Ficha técnica e ficha de produção abrem o editor certo, com a nota como insumo.
- [x] Agrupamento promove o vendido e liga as notas como variantes.
- [x] Variante pede o agrupamento e liga o vendido.
- [x] «É um produto interno» dispensa o vendido sem unificar.
- [x] Nome com sinal de dose (ex. DS) começa em ficha, não em unificar.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Reutilizar `promoteProductToSaleFamily`, `linkSaleFamilyVariant`, `dashboardImportReviewSetResolution` e o revert de stub de ficha do `ProductSetupActionPanel`. `technicalSheetKind` `"sale"` vs `"intermediate"`.
