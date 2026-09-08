# Feature: Lista de contagem única e cancelar no Histórico

- **Slug:** `contagem-lista-unica`
- **Status:** feita
- **Área:** `/app/produtos/contagem` · Listas e Histórico

## Problema

Toda listagem vive num setor (grupo). Não dá para montar uma lista avulsa, contar agora ou programar uma vez, sem ela virar rotina do card do grupo. Sessões abertas sem querer (várias Pendente) não têm como ser canceladas.

## Objetivo

O gestor cria uma lista única (produtos + operador), conta na hora ou programa uma data (`once`). No Histórico, cancela sessões ainda não ajustadas no estoque.

## Fora de escopo

- Apagar a lista sozinha depois do commit.
- Recorrência (N dias / semana sim-não) em lista única.
- Contagem geral de todos os produtos (onboarding).
- Agendamentos de setor reusando sessão aberta.
- Desfazer `committed` (estornar estoque).

## Contexto no código

- Páginas / rotas: `/app/produtos/contagem`
- Componentes: `EstoqueContagemListasTab`, `EstoqueContagemListingSheet`, `EstoqueContagemPanel`, `EstoqueContagemScheduleDialog`, `EstoqueHistoricoContagem`, `EstoqueAprovacaoContagem`
- Libs: `web/src/lib/inventoryCount/createSession.ts`, `ui.ts`
- Backend: `inventory_count_listings.inventory_count_group_id` nullable; status `cancelled`; RPC `cancel_inventory_count_session`; `submit_inventory_count_for_approval` não exige grupo se já há listagem
- Reuso: `contagem-reusar-sessao-aberta`

## Comportamento esperado

- **Nova lista única** na aba Listas. Card **Listas únicas** fora dos setores. Sheet sem grupo.
- Contar esta lista / Programar (`once`). Reuso se já houver `open`/`returned`.
- Setor **Contar agora** não inclui avulsas.
- Histórico/Aprovar: grupo **Única** quando não há setor.
- **Cancelar** no Histórico para `open`, `returned`, `pending_approval`. Link público deixa de valer. Não cancela `committed`/`approved`.

## Critérios de aceite

- [x] Criar lista única sem grupo; aparece só no card Listas únicas.
- [x] Contar agora gera link; segundo clique pergunta (reuso).
- [x] Programar avulsa só `once`; sessão nasce na data.
- [x] Contar agora no setor não abre sessão da lista única.
- [x] Cancelar no Histórico: Pendente some de Em andamento; link público recusa.
- [x] committed/approved não mostram Cancelar.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Não criar grupo fantasma “Únicas”. Dialog para confirmar cancelamento (não `window.confirm`).
