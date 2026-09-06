# Feature: Conferir contagem na aba Aprovar

- **Slug:** `contagem-aprovar-conferir`
- **Status:** feita
- **Área:** `/app/produtos/contagem` · aba Aprovar

## Problema

Clicar em **Conferir** numa sessão pendente não abria a conferência (painel só com `lines.length > 0`). Sessões `pending_approval` **sem linhas** ainda apareciam para aprovar — o submit aceitava lista vazia (`COUNT` de `counted_qty IS NULL` = 0). Sem linhas não houve contagem.

## Objetivo

Aprovar só lista sessões com itens contados. Conferir abre o sheet com essas linhas.

## Fora de escopo

- Apagar sessões vazias no banco.
- Mudar o fluxo público além de recusar submit sem linhas.

## Contexto no código

- `web/src/components/estoque/EstoqueAprovacaoContagem.tsx`
- `web/src/components/estoque/EstoqueContagemPanel.tsx` — badge Aprovar
- `submit_inventory_count_for_approval`

## Comportamento esperado

- Aprovar / badge: só sessão `pending_approval` com pelo menos uma linha.
- Conferir abre sheet com as linhas. Cards no celular, tabela nos demais.
- Submit sem linhas: `incomplete`.
- Conferir que vier vazio: fecha, some da lista, aviso curto.

## Critérios de aceite

- [x] Sessão sem linhas não aparece em Aprovar nem no badge.
- [x] Conferir com linhas abre o sheet.
- [x] Submit RPC recusa sessão sem linhas.
- [ ] Verificar no browser o fluxo (não só screenshot).

## Notas para a IA

Não inventar filtro novo. Não usar `sm:max-w-*` no sheet.
