# Feature: Unificar primeiro na tabela de correlação

- **Slug:** `correlacao-unificar-primeiro`
- **Status:** em-andamento
- **Área:** `/app/produtos` (Correlação · Correlação 2)

## Problema

A tabela mistura o que já era match de unificar (≥ 90%, mesmo produto) com o resto da fila. Quem quer só confirmar o par igual tem que achar no meio da listagem.

## Objetivo

Os itens que entram no match de unificação (o antigo bloco Mesmo produto) aparecem primeiro. O restante da lista segue a ordem de sempre.

## Fora de escopo

- Mudar o critério do match (`isInitialUnifyMatch`).
- Trocar o apply da unificação.
- Esconder compras da nota que também são par do match.

## Contexto no código

- `web/src/lib/productValidation/types.ts` — `isInitialUnifyMatch`
- `web/src/lib/productValidation/correlationCase.ts`
- `web/src/components/products/correlacao2/CorrelationCaseWorkbench.tsx`

## Comportamento esperado

- No topo: vendidos com same-item alta e sem conflito de ficha.
- Dentro desse bloco: a ordenação da tabela (giro ou nome).
- Depois: o resto, vendas e em seguida compras, com a mesma ordenação.

## Critérios de aceite

- [x] Match ≥ 90% sem sinal de ficha sobe na lista, mesmo com giro menor.
- [x] Item só de ficha ou match fraco não entra nesse bloco.
- [x] Ordenar por nome ou giro reordena dentro de cada bloco, sem misturar.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Reutilizar `isInitialUnifyMatch`. Não inventar segundo corte de confiança.
