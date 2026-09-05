# Feature: Filtro de período no histórico de checklists

- **Slug:** `checklist-historico-filtro-periodo`
- **Status:** pronto
- **Área:** `/app/checklists/historico`

## Problema

O histórico filtra por “um dia / 7 dias / intervalo”, diferente da barra de Notas e recebimento (mês + de/até).

## Objetivo

O histórico usa o mesmo filtro de período: seletor de mês e datas de início e fim.

## Fora de escopo

- Mudar a tabela de envios ou os filtros de checklist/operador (só o visual da barra).
- Persistência do período na URL.

## Contexto no código

- `web/src/components/checklist/ChecklistHistorySection.tsx`
- `web/src/pages/Despesas.tsx` — barra de Notas e recebimento
- `web/src/components/ReferencePeriodCard.tsx`
- `web/src/lib/monthYmdRange.ts`
- `web/src/lib/checklistSpDay.ts` — `spCivilRangeBoundsUtc`

## Comportamento esperado

- Seletor de mês compacto (`ReferencePeriodCard`). Trocar o mês redefine de/até para o mês inteiro.
- Inputs de data início e fim, padrão o mês atual.
- Checklist e operador continuam na mesma barra.
- **Limpar** volta as datas ao mês e os selects para todos.
- Consulta continua em fuso America/Sao_Paulo.

## Critérios de aceite

- [x] Some o seletor “Um dia / Últimos 7 dias / Intervalo”.
- [x] A barra replica mês + de/até de Notas e recebimento.
- [x] Trocar o mês atualiza o intervalo e a lista.
- [x] Checklist e operador ainda filtram.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Reutilizar `ReferencePeriodCard` compacto e as classes da barra em `Despesas.tsx`. Bounds da query: `orderedYmdRange` + `spCivilRangeBoundsUtc`.
