# Feature: Correlação 2 — fila + inspector

- **Slug:** `correlacao-2`
- **Status:** pronto
- **Área:** `/app/produtos/correlacao-2`

## Problema

A correlação atual parte a mesma decisão em duas telas (cards ≥ 90% e «Para corrigir»), com dois enums e dois apply. Confiança da IA virou fronteira de layout.

## Objetivo

Aba **Correlação 2**: uma fila de casos e um inspector. Intent como ação; confiança só ordena. A correlação original permanece.

## Fora de escopo

- Apagar ou alterar a tela `/app/produtos` (Correlação).
- Trocar o contrato da IA `correlate-sold-purchased`.
- Extrair o editor de ficha do `EstoqueReceitasPanel`.
- Unificar ficha ou agrupamento com a nota.

## Contexto no código

- `web/src/components/ProdutosEstoqueLayout.tsx`
- `web/src/lib/productValidation/correlationCase.ts`
- `web/src/components/products/correlacao2/`
- `web/src/components/products/ProductSetupActionPanel.tsx` — workspaces
- `docs/dominio/produtos.md`

## Comportamento esperado

- Aba **Correlação 2** ao lado de Correlação.
- Uma fila: todos os itens pendentes. Score da IA ordena; não esconde ninguém.
- Inspector à direita: header do item, seletor de intent já marcado, workspace abaixo conforme a opção.
- Se o intent veio da IA, o card da direita mostra que é sugestão do agente.
- Workspace reutiliza as ações atuais (unificar, ficha, agrupamento, variante, insumo, produto interno).
- Tag **Somente estoque** só com intent variante.
- Criar agrupamento no seletor, pelo nome.
- Fila visível sem rodar o agente; o agente só enriquece pares e score.
- Filtro padrão: busca + origem + Limpar.
- Ao vincular, atribuir ou confirmar um caso, o item some da lista na hora.
- Variante ou agrupamento já ligado não volta ao reabrir a aba.

## Critérios de aceite

- [x] Existe a aba e a rota `/app/produtos/correlacao-2`.
- [x] A tela original de correlação continua igual.
- [x] Lista única; não há bloco «≥ 90%» separado de «Para corrigir».
- [x] Sem coluna Par. Intent no inspector é um seletor, já pré-marcado.
- [x] Indicação da IA aparece no card da direita.
- [x] Confirmar um intent grava pelo mesmo caminho da correlação atual.
- [x] Depois de vincular/atribuir/confirmar, o item some da listagem.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Reutilizar `fetchProductSetupQueue`, sessão de validação, `ProductSetupActionPanel` e `applySoldAs*`. Não inventar um segundo apply.
