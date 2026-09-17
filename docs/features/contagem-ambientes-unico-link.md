# Feature: Contagem unificada (rodada entre setores)

- **Slug:** `contagem-ambientes-unico-link`
- **Status:** pronta
- **Área:** `/app/produtos/contagem` · `/contagem-estoque/:token`

## Problema

Contar agora abre um link por listagem. Estoque é da empresa. Heineken em Câmara Fria e Bar 1, contada em dois links, não soma: o segundo commit distorce o primeiro. Não dá para pausar com status dos pontos, nem navegar entre setores no mesmo link.

## Objetivo

Uma rodada = um link, N setores. O operador navega pelos pontos, salva para pausar, e o estoque só atualiza quando o SKU foi contado em todos os pontos ativos. Conferência pesa divergência em R$.

## Fora de escopo

- Estoque persistido por local.
- Somar sessões distintas (dois links).
- Peso configurável além do custo cadastrado.
- Mudar onboarding / lista única (1 listagem = 1 sessão).

## Contexto no código

- Páginas / rotas: `/app/produtos/contagem`, `/contagem-estoque/:token`, `/i/:slug`
- Componentes: `EstoqueContagemPanel`, `EstoqueContagemListasTab`, `EstoqueContagemReuseDialog`, `EstoqueAprovacaoContagem`, `EstoqueHistoricoContagem`, `ContagemEstoquePublic`
- Libs: `web/src/lib/inventoryCount/createSession.ts`, `ui.ts`
- Backend: `inventory_count_*`, RPCs `open_inventory_count_session`, `seed_inventory_count_lines`, `get_inventory_count_public`, `set_inventory_count_line_public`, `submit_inventory_count_for_approval`, `commit_inventory_count_session`, `process_due_inventory_count_schedules`
- Regras: tabelas-e-sheets, selects, filtros, features

## Comportamento esperado

- Contar agora: dialog se outros setores compartilham SKU (marcados por padrão) → um link.
- Reuso: sessão `open`/`returned` cujo `session_groups` contém o setor → mesmo link.
- Operador: hamburger por setor/listagem, Salvar (pausa), Enviar só com linhas da rodada preenchidas.
- Commit: soma por SKU; pula se faltar ponto ativo da empresa.
- Aprovar: uma linha por produto, impacto R$, sort impacto desc. Badge se não atualiza estoque.

## Critérios de aceite

- [x] Contar agora em Bar 1 com Heineken na Câmara Fria: dialog; um link; hamburger com os dois setores.
- [x] Heineken nos dois pontos: um commit; estoque = soma.
- [x] Recusar Câmara Fria: envia a rodada; Heineken não ajusta estoque.
- [x] Clique em Câmara Fria com rodada de Bar 1 já aberta (inclui Câmara): reusa o mesmo link.
- [x] Salvar pausa; reabrir continua.
- [x] Conferir ordena por impacto R$.
- [x] Lista única / Contar esta lista / onboarding não quebram.
- [x] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Linha da contagem identifica por `line_id` (mesmo SKU em dois pontos). Unique parcial em `(session, listing, product)`. Agenda de grupo abre uma sessão expandida. Sheet do hamburger: padrão (tela cheia no celular, 70% a partir de `md`). Dialog para inclusão de setores, não sheet.
