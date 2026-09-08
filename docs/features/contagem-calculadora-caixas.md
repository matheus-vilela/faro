# Feature: Calculadora de caixas na contagem do operador

- **Slug:** `contagem-calculadora-caixas`
- **Status:** feita
- **Área:** `/contagem-estoque/:token` (link público do operador)

## Problema

O operador conta um único número + unidade. Dá para escolher `cx` quando há conversão, mas não dá para somar caixas cheias com unidades soltas (ex.: 2 caixas de 12 + 3 avulsas = 27). Sem conversão cadastrada, não há ajuda para calcular o total a partir de packs.

## Objetivo

No link de contagem, o operador pode opcionalmente informar caixas, unidades por caixa e avulsas; o total vira a quantidade já persistida hoje.

## Fora de escopo

- Gravar caixas/avulsas em colunas novas.
- O operador criar ou alterar `unit_conversions` do produto.
- Calculadora na aba Aprovar / conferir do gestor.
- Campo `units_per_box` no cadastro.

## Contexto no código

- Páginas / rotas: `web/src/pages/ContagemEstoquePublic.tsx` · `/contagem-estoque/:token`
- Componentes: `web/src/components/estoque/InventoryCountPackCalculator.tsx`
- Hooks / libs: `web/src/lib/inventoryCount/packCountCalculator.ts`, `conversionHint.ts`
- Backend: `inventory_count_public_allowed_units` (campo `qty_in_hub`); save continua `set_inventory_count_line_public`
- Regras: não vazar `expected_qty`; página pública anônima

## Comportamento esperado

- Campo grande de quantidade permanece. Abaixo, card recolhível “Contar em caixas” (ou pacotes/fardos).
- Total = `(caixas × por caixa) + avulsas` na unidade de estoque. Se o hub já for caixa/pack: `caixas + avulsas / por caixa`.
- Com conversão (`1 cx = 12 un`), “por caixa” inicia em 12. Sem conversão, inicia em 12 e o operador ajusta (só nesta tela).
- Usar a calculadora preenche a quantidade e usa a unidade de estoque. Enter / Próximo / Enviar leem o campo preenchido.
- Tokens `primary` / `muted` (não paleta fixa do print). Sem saldo esperado.

## Critérios de aceite

- [x] Com `1 cx = 12 un`, a calculadora abre com 12 em “por caixa”; 2 caixas + 3 avulsas grava 27 `un`.
- [x] Sem conversão, o operador define “por caixa”; o total grava na unidade de estoque; o produto não ganha conversão.
- [x] Quantidade digitada direto continua funcionando.
- [x] Recontagem e salto por código de barras não quebram.
- [x] Conferência do gestor continua vendo um número + unidade.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Reutilizar `allowed_units` / `qty_in_hub`. Não persistir o breakdown. Remontar a calculadora ao trocar de produto (`key={product.id}`).
