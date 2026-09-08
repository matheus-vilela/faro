# Feature: Agenda de contagem e lista única some após aprovar

- **Slug:** `contagem-aba-agenda`
- **Status:** pronto
- **Área:** `/app/produtos/contagem`

## Problema

Lista única continua no card depois de aprovada. Datas de agenda estão espalhadas nas Listas. O card Agendadas abre Listas, não uma visão da fila.

## Objetivo

Lista única some das Listas quando a contagem é aprovada (estoque ajustado). Agenda vive numa aba própria, ordenada por data; o card do topo abre essa aba.

## Fora de escopo

- Apagar sessão/histórico.
- Recorrência em lista única.
- Reusar sessão aberta no cron de agenda.
- Estornar `committed`.

## Contexto no código

- `EstoqueContagemPanel.tsx`, `EstoqueContagemSummaryCards.tsx`, `EstoqueContagemListasTab.tsx`, `EstoqueContagemListingSheet.tsx`
- Novo: `EstoqueContagemAgendaTab.tsx`
- `commit_inventory_count_session`
- Tabelas: `SortableTableHead` + `useClientTableSort`; cards só no celular (`useSheetListView`)
- Filtro compacto: busca + SearchSelect `size="sm"` + Limpar

## Comportamento esperado

- Ao **aprovar** (commit) uma sessão de listagem sem grupo: `archived_at` na listagem; agendas ativas dela desligam. Histórico mantém o nome (FK permanece).
- Setor não arquiva.
- Cancelar sessão não arquiva a lista.
- Aba **Agenda**: ativas por `next_run_at`. Editar / desativar. Sem texto “próxima” nas Listas nem no sheet (Programar continua).
- Card **Agendadas** → aba Agenda. Badge na aba com a quantidade.

## Critérios de aceite

- [x] Lista única some de Listas depois de Aprovar.
- [x] Histórico ainda mostra o nome da listagem.
- [x] Aba Agenda lista só ativas, ordenável.
- [x] Card Agendadas abre a aba Agenda.
- [x] Listas/sheet não mostram a data espalhada.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Não DELETE da listagem (sessão perderia o nome). Arquivar.
