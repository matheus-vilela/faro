# Feature: Reusar contagem aberta em vez de criar outra

- **Slug:** `contagem-reusar-sessao-aberta`
- **Status:** feita
- **Área:** `/app/produtos/contagem` · aba Listas

## Problema

Cada clique em **Contar agora** ou **Contar esta lista** cria uma sessão `open` nova. Não há checagem se a listagem já tem contagem em andamento ou recontagem. Cliques repetidos (e o botão do grupo) empilham Pendente no Histórico e o card Em andamento sobe. Não dá para cancelar sessão: o padrão tem que ser não criar.

## Objetivo

Se a listagem já tem sessão `open` ou `returned`, o painel pergunta se continua a existente (mesmo link) ou começa outra — o padrão seguro é continuar.

## Fora de escopo

- Cancelar/descartar sessões no Histórico.
- Agendamentos (`process_due_inventory_count_schedules`).
- Conferir expandido vs sheet.
- Mudar o link público do operador.
- Auto-reuso na RPC `open_inventory_count_session` (o usuário precisa escolher).

## Contexto no código

- Páginas / rotas: `/app/produtos/contagem`
- Componentes: `web/src/components/estoque/EstoqueContagemPanel.tsx`, `EstoqueContagemListasTab.tsx`, `EstoqueContagemReuseDialog.tsx`
- Hooks / libs: `web/src/lib/inventoryCount/createSession.ts`
- Backend: leitura de `inventory_count_sessions` + `inventory_count_short_links`; criar continua a RPC existente
- Regras: dialog (não sheet) para esta confirmação

## Comportamento esperado

- Sessão ativa = `open` ou `returned`. `pending_approval` não entra no reuso; aviso discreto se existir ao criar outra.
- Listagem sem ativa: cria como hoje e mostra o diálogo de links.
- Listagem com ativa: dialog **Já existe uma contagem desta lista** — Continuar esta (principal, mesmo link, sem WhatsApp de novo) / Começar uma nova (a anterior continua no Histórico) / Cancelar. Várias abertas: usa a mais recente e cita N.
- Grupo com alguma ativa: um dialog — Continuar as existentes e abrir só as que faltam / Abrir tudo de novo / Cancelar.
- Badge na linha da listagem: Em andamento ou Recontagem.

## Critérios de aceite

- [x] Sem sessão ativa, Contar esta lista cria uma e mostra o link.
- [x] Com sessão ativa, o clique não cria; o dialog pergunta.
- [x] Continuar esta mostra o mesmo URL; Em andamento não sobe.
- [x] Começar uma nova cria a segunda; o texto avisa que a anterior continua.
- [x] Contar agora no grupo com mix: continua as abertas e só cria as que faltam (ação principal).
- [x] Listagem com ativa mostra badge antes do clique.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Não alterar a RPC para auto-reusar. Manter `countingId` no botão durante o request. Reusar `inventoryCountPublicUrl` e o dialog de links já existente.
