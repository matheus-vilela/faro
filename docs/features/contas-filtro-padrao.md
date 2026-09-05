# Feature: Filtro padrão em calendário e listagem

- **Slug:** `contas-filtro-padrao`
- **Status:** pronto
- **Área:** `/app/contas-a-pagar` · `/app/contas-a-pagar/listagem`

## Problema

Calendário e listagem de contas a pagar usam o card grande de mês. A listagem só tem busca à parte. O padrão do sistema (Notas e recebimento) é a barra compacta: mês + de/até + busca + Limpar.

## Objetivo

Calendário e listagem usam a mesma barra de filtro de Notas e recebimento.

## Fora de escopo

- Mudar totais do mês, pagamento ou projeções.
- Recriar as visões por categoria / vencimento / status.
- Persistência do período na URL.

## Contexto no código

- `web/src/components/fluxo/FluxoBoletosPage.tsx`
- `web/src/pages/ContasAPagar.tsx`
- `web/src/pages/Despesas.tsx` — barra de referência
- `web/src/components/ReferencePeriodCard.tsx`
- `web/src/lib/monthYmdRange.ts`

## Comportamento esperado

- Barra compacta nas duas seções: seletor de mês, data início, data fim, busca, Limpar.
- Trocar o mês redefine de/até para o mês inteiro e recarrega calendário e lista.
- Listagem consulta o intervalo de/até (não só o mês fechado).
- Calendário continua no mês selecionado; só mostra vencimentos dentro de/até.
- Busca vale na listagem (e no que aparece no calendário).

## Critérios de aceite

- [x] Card grande de período some; a barra replica Notas e recebimento.
- [x] Calendário e listagem compartilham o mesmo filtro.
- [x] Trocar o mês atualiza de/até e os dados.
- [x] Limpar volta datas ao mês e esvazia a busca.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

`applyPeriod` em payable e receivable. Lista payable usa `listDateRange`. Não duplicar de/até dentro de `VendasRealizadasListTable`.
