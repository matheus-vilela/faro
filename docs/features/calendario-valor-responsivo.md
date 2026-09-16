# Feature: Valor do calendário responsivo

- **Slug:** `calendario-valor-responsivo`
- **Status:** pronta
- **Área:** `/app/contas-a-pagar`

## Problema

No calendário de contas a pagar, o valor (ex. A PAGAR − R$ 100,00) fica grande demais em telas menores. O texto quebra e corta o valor.

## Objetivo

O valor do dia encolhe com a célula e cabe inteiro em telas estreitas.

## Fora de escopo

- Mudar totais, cores ou o que entra em A pagar / A confirmar.
- Listagem de contas.
- Recalcular valores.

## Contexto no código

- `web/src/components/BoletosCalendar.tsx` — `CalendarDayValueBucket`

## Comportamento esperado

- O tamanho do valor segue a largura da célula do dia, não o breakpoint `sm` da viewport.
- Em célula estreita, a fonte é menor e o valor não quebra linha.
- Em célula larga, o valor volta ao tamanho atual.

## Critérios de aceite

- [x] Em viewport estreita, o valor A PAGAR cabe na célula sem cortar (ex. R$ 100,00).
- [x] Em desktop largo, o valor continua legível.
- [x] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Usar `@container` na célula do dia (já há esse padrão em `DashboardQuickLinks`). Não aumentar a fonte em `sm:` — com a sidebar, a célula continua estreita.
