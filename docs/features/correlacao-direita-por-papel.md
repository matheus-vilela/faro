# Feature: Correlação — direita muda com o papel

- **Slug:** `correlacao-direita-por-papel`
- **Status:** pronto
- **Área:** `/app/produtos` (Correlação · configurar o vendido)

## Problema

O lado direito do card sempre mostra a nota para unificar. Se o vendido é ficha (técnica ou de produção), a nota não é o mesmo cadastro: o fluxo certo é o da ficha — buscar insumo, quantidade e unidade. O mesmo vale para os outros papéis: a direita não acompanha o que foi marcado à esquerda.

## Objetivo

A coluna da direita segue o papel do vendido. Em ficha técnica ou de produção, abre o editor padrão de insumos no próprio card.

## Fora de escopo

- Mudar o editor de ficha (`EstoqueReceitasPanel`).
- Inferir o papel sozinho.
- Alterar «Para corrigir».

## Contexto no código

- `web/src/components/products/ProductValidationCards.tsx`
- `web/src/components/products/ProductValidationFlow.tsx`
- `web/src/components/estoque/EstoqueReceitasPanel.tsx`
- `web/src/lib/productValidation/soldRole.ts`
- `docs/dominio/produtos.md`

## Comportamento esperado

| Papel | Direita |
|---|---|
| Pode ser mesmo produto da nota | Compras da nota + Unificar |
| É um produto interno | A nota fica na fila; confirmar o vendido |
| Ficha técnica | Editor de ficha (busca, qtde, unidade, adicionar). Nota pode pré-preencher insumo com qtde vazia |
| Ficha de produção | O mesmo editor, tipo produção |
| É um agrupamento | Compras da nota como variantes + confirmar |
| Faz parte de um agrupamento | Sem lista de unificar; destino já está à esquerda |

## Critérios de aceite

- [x] Com o papel já escolhido, o editor não pede de novo se é ficha normal ou de produção.
- [x] Marcar ficha de produção troca a direita para o fluxo de insumos, não a nota para unificar.
- [x] Ficha técnica usa o mesmo editor (não unificar).
- [x] Unificar só aparece em «Pode ser mesmo produto da nota».
- [x] Produto interno e variante não listam a nota como par de unificação.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Reutilizar `EstoqueReceitasPanel` `embedInline` + `ingredientsOnly` + `technicalSheetKind`, como em `ProductSetupActionPanel`. Prefill da nota com quantidade vazia.
