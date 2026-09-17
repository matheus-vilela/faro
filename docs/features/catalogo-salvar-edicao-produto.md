# Feature: Salvar edição no catálogo (erro visível + preço)

- **Slug:** `catalogo-salvar-edicao-produto`
- **Status:** feita
- **Área:** `/app/produtos/catalogo` · sheet Editar produto

## Problema

Na Eulália, a edição de `CRAVO DA INDIA *FLOR* GRANEL` não grava. O `Salvar` do catálogo falha em silêncio (`console.error` sem toast). Produtos vindos de NF-e costumam ter `last_unit_value` com mais de 2 casas; o formulário arredonda para centavos e o save trata isso como mudança de custo, dispara o trigger de backfill de CMV e o update do produto pode estourar timeout. Unidade do preço em caixa diferente (`KG` vs `kg`) também suja o save.

## Objetivo

Salvar a edição do cadastro (nome, categorias, estoque, etc.) sem regravar preço/custo que o usuário não alterou. Estoque negativo é válido (fica até entrada ou contagem). Se o banco recusar, mostrar o erro na tela.

## Fora de escopo

- Recalcular CMV histórico em background (fila/job).
- Mudar a sanitização do nome (`*FLOR*` no meio continua válido).
- Tela de correlação / unificar.

## Contexto no código

- `web/src/pages/Produtos.tsx` — `handleStockSave`
- `web/src/lib/catalogProductEdit.ts` — dirty-check de preço e unidade
- Trigger `tr_products_refresh_revenue_cmv` em `public.products`

## Comportamento esperado

- Preço do formulário (2 casas) vs valor gravado: se os centavos são iguais, não mexe em `last_unit_value` / `average_cost`.
- Código de unidade comparado sem diferenciar maiúsculas.
- Falha de validação ou de persistência: toast com a mensagem.
- Backfill de CMV não pode abortar o `UPDATE` do produto.
- Saldo em estoque negativo: o save não exige zerar nem alterar a quantidade.

## Critérios de aceite

- [x] Editar só o nome de um produto com preço de NF (muitos decimais) grava o nome.
- [x] Erro de banco aparece em toast; o botão não fica em “Salvando...” para sempre.
- [x] Unidade `KG` no banco e `kg` no form não dispara save de preço.
- [x] Testes unitários do dirty-check de preço/unidade.
- [x] Produto com estoque negativo salva as outras alterações sem obrigar a mudar a quantidade.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

- `sanitizeCatalogProductName` só tira `*` no **início**; `*FLOR*` no meio permanece.
- O trigger de CMV corre no mesmo transaction do update; timeout = save falha e some o toast.
