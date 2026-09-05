# Feature: Produto intermediário (ficha que estoca)

- **Slug:** `produto-intermediario`
- **Status:** em-andamento
- **Área:** `/app/produtos` · `/app/fichas-tecnicas` · estoque · venda

## Problema

A ficha técnica de hoje (`RECIPE_CONTROLLED` + `recipe_type` PREP/SALE) explode insumos **na venda**. O prato some do catálogo (`listed_in_product_catalog = false`) e **não tem saldo próprio**.

Isso não cobre o caso em que a casa **produz e guarda** um item (molho, massa, pré-preparo) e depois vende (ou usa) esse item. Hoje, ou a venda baixa os insumos de novo, ou o estoque do preparado não existe.

O tipo `COMPOSITE` **não serve**: não tem BOM. `PRODUCTION` já existe em `recipes.recipe_type`, mas não é usado. A tela **Baixa por preparo** só desconta insumos — não entra quantidade no produto de saída.

## Objetivo

Uma ficha técnica pode gerar um **produto intermediário**: item com estoque próprio. Produzir baixa os insumos e entra o saldo do intermediário. Vender (ou sair o intermediário) baixa **só o estoque dele**, nunca os insumos da ficha.

## Fora de escopo

- Transformar agrupamento (`SALE_FAMILY`) em intermediário, ou o contrário.
- Inferir sozinho que um produto “deveria” ser intermediário.
- Recalcular vendas/EPOC já importadas ao mudar o tipo.
- Produção automática (só lançamento explícito nesta entrega).
- Estorno/cancelamento de produção além do fluxo de movimento já existente.
- Ficha `ENTRY_BREAKDOWN` (desmonte de compra) — continua só na importação.
- Multi-nível automático além do que já cai no saldo: se o insumo for outro intermediário, baixa o saldo dele; **não** explode a ficha do insumo na produção do pai.
- Converter em lote fichas normais já cadastradas (conversão pontual no detalhe, se entrar; sem job).
- UI nova de CMV/DRE: o CMV da venda do intermediário usa o custo médio do produto, como `DIRECT`.

## Contexto no código

Arquivos e peças que a IA deve abrir primeiro:

- Páginas / rotas:
  - `web/src/pages/Produtos.tsx` — catálogo e detalhe
  - `web/src/pages/FichasTecnicas.tsx` — lista de fichas
- Componentes:
  - `web/src/components/products/ProductSetupCard.tsx` — seletor Ficha técnica
  - `web/src/components/products/ProductTechnicalSheetDialog.tsx`
  - `web/src/components/estoque/EstoqueReceitasPanel.tsx` — cadastro da ficha + **Baixa por preparo** (hoje só consome insumos)
  - `web/src/components/products/ProductDetailSummary.tsx`
  - `web/src/components/products/ProductCatalogCard.tsx` — badges do card (hoje: Agrupamento)
  - `web/src/components/products/ProductCatalogTable.tsx` — rótulo ao lado do nome
  - `web/src/pages/Produtos.tsx` — badge no header do sheet de detalhe
- Hooks / libs:
  - `web/src/lib/productTechnicalSheet.ts` — `get/upsert_product_technical_sheet`
  - `web/src/lib/productSaleFamily.ts` — ficha ≠ agrupamento
  - `web/src/lib/manualStockMovement.ts` — classificação `production` já existe
  - `web/src/types/product.ts` — `stock_control_type`
- Backend (tabelas, RPCs, functions):
  - `products.stock_control_type` — CHECK atual: `DIRECT | RECIPE_CONTROLLED | COMPOSITE | SERVICE | SALE_FAMILY`
  - `recipes.recipe_type` — CHECK atual: `SALE | ENTRY_BREAKDOWN | PREP | PRODUCTION` (`PRODUCTION` reservado, sem uso)
  - `upsert_product_technical_sheet` / `get_product_technical_sheet` — só PREP/SALE; marca `RECIPE_CONTROLLED`
  - `consume_recipe_stock` — baixa insumos
  - `propagate_recipe_stock_on_output_out` — explode PREP/SALE quando o prato sai
  - `adjust_product_stock` — chama a explosão em saída
  - `apply_epoc_stock_variant_outs` — pula `RECIPE_CONTROLLED` “puro”
- Regras Cursor relacionadas:
  - `.cursor/rules/features.mdc`
  - `docs/features/epoc-agrupamento-venda-estoque.md` — tabela ficha × agrupamento (não misturar)
  - `docs/features/produto-detalhe-configuracao.md` — card Configuração

## Dois tipos de ficha (não misturar)

| | **Ficha normal** (hoje) | **Ficha de intermediário** (novo) |
|---|---|---|
| Exemplo | Caipirinha | Molho de tomate, massa fresca |
| `stock_control_type` | `RECIPE_CONTROLLED` | `INTERMEDIATE` |
| `recipe_type` | `PREP` / `SALE` | `PRODUCTION` (já no CHECK) |
| Aparece em Produtos | Não (`listed_in_product_catalog = false`) | Sim — tem saldo |
| Quando produz | Opcional: “Baixa por preparo” só some insumos; o prato não estoca | Ação **Produzir**: some insumos **e** entra no intermediário |
| Quando vende / sai | Explode insumos (`propagate_recipe_stock_on_output_out`) | Baixa **só** o saldo do intermediário, como `DIRECT` |
| Insumos saem | Na venda (e no backfill histórico) | **Só na produção** |
| Pode ser insumo de outra ficha | Em geral o prato não é SKU de estoque | Sim; a baixa é no saldo do intermediário |

Agrupamento continua o terceiro mecanismo: venda sem baixa no cardápio. Intermediário **não** é agrupamento.

Não reusar `COMPOSITE`.

## Comportamento esperado

### Cadastro

- No card **Configuração**, o seletor de ficha passa a ter três caminhos:
  - **Não**
  - **Ficha normal** — explosão na venda (comportamento atual)
  - **Produto intermediário** — produz e estoca
- Salvar a ficha de intermediário:
  - Cria/atualiza `recipes` com `recipe_type = PRODUCTION`, `output_product_id` = o produto
  - Marca `stock_control_type = INTERMEDIATE`
  - Mantém `listed_in_product_catalog = true`
  - **Não** roda `backfill_technical_sheet_from_output_history` (isso reescreveria saídas antigas como explosão de insumos)
- Mesmas regras de insumos da ficha atual: pelo menos um, sem duplicata, sem ser o próprio produto, conversão de unidade obrigatória.
- Um produto não pode ser ao mesmo tempo `RECIPE_CONTROLLED`, `INTERMEDIATE` e `SALE_FAMILY`. Pode ser **variante** de um agrupamento (é SKU com estoque).
- Insumo pode ser `DIRECT` ou outro `INTERMEDIATE`.

### Produção

- Ação explícita **Produzir** (detalhe do intermediário e lista de fichas / evolução do card “Baixa por preparo”).
- Usuário informa **quantas receitas** vai produzir. Entrada = receitas × `batch_yield`. Saída de cada insumo = quantidade da ficha × receitas.
- Uma RPC (ex. `produce_intermediate_product`):
  1. `consume_recipe_stock` nos insumos (mesmo scale da ficha)
  2. `adjust_product_stock` **entrada** no intermediário
  3. Movimentos com `reference_type` próprio (ex. `intermediate_production`) e classificação `production`
- A entrada **não** dispara explosão (só saída de PREP/SALE explode).
- Custo da entrada: custo médio ponderado a partir do `average_cost` (ou `last_unit_value`) dos insumos × quantidade consumida / quantidade produzida, para o CMV da venda futura do intermediário.
- Estoque negativo de insumo: mesma regra de `consume_recipe_stock` (hoje permite).
- Produzir ficha **normal** pelo card antigo **não** entra saldo no prato. Só intermediário entra.

### Venda e outras saídas

- Venda (`product_sale`, EPOC, ajuste, perda): baixa o intermediário 1:1, como `DIRECT`.
- `propagate_recipe_stock_on_output_out` ignora `recipe_type = PRODUCTION` (já ignora o que não é PREP/SALE — manter assim).
- `apply_epoc_stock_variant_outs`: intermediário **pode** baixar (não pular como `RECIPE_CONTROLLED` puro).
- CMV na venda: custo médio do intermediário, se `composes_cmv`.

### Catálogo, listagens e copy

- Intermediário aparece na listagem de Produtos, com quantidade, mínimo, alertas e valor em estoque.
- **Badge no catálogo** (obrigatório): quem olha a lista precisa ver na hora que o item é de produção, sem abrir o detalhe.
  - Texto: **Produção**. Não usar “Ficha técnica” (esse badge é da ficha normal, que nem aparece no catálogo).
  - Mesmo padrão do badge **Agrupamento**: `Badge` no card (`ProductCatalogCard`); rótulo compacto ao lado do nome na tabela (`ProductCatalogTable`).
  - Cor distinta: Agrupamento = sky; Ficha técnica no detalhe = violeta; Produção = teal/esmeralda (ex. `border-teal-500/40 bg-teal-500/10 text-teal-950 dark:text-teal-100`). Ícone próprio (ex. `Factory`), não `ChefHat` nem `Layers`.
  - Pode coexistir com Inativo, Estoque zerado/baixo e “Possível agrupamento” se o item ainda tiver essa tag.
- No **header do detalhe** (`Produtos.tsx`): o mesmo badge **Produção** no lugar em que hoje aparece “Ficha técnica” / “Agrupamento”. Não mostrar os dois (“Ficha técnica” + “Produção”) no intermediário.
- Lista de fichas técnicas mostra os dois tipos, com rótulo distinto (**Ficha** vs **Produção**).
- Copy da ficha normal não muda: venda baixa insumos. Código interno continua `INTERMEDIATE`.

### Conversão pontual (se o seletor permitir nesta entrega)

- `DIRECT` → intermediário: grava ficha `PRODUCTION` + tipo; saldo atual permanece (não zera).
- Ficha normal → intermediário: muda tipo e `recipe_type`; volta a listar no catálogo; **não** backfill; vendas futuras deixam de explodir. Saldo do produto (em geral 0) passa a ser o que vale.
- Intermediário → ficha normal: só se o usuário escolher ficha normal de novo; some do catálogo; explosão volta nas saídas seguintes. Avisar se houver saldo > 0 (o saldo do intermediário deixa de ser o que a venda baixa).
- Intermediário → sem ficha: tipo volta a `DIRECT`; receita `PRODUCTION` inativa ou apagada; saldo permanece.

## Critérios de aceite

- [x] `stock_control_type` aceita `INTERMEDIATE`; `COMPOSITE` e `RECIPE_CONTROLLED` não mudam de significado.
- [x] Ficha de intermediário grava `recipes.recipe_type = PRODUCTION` e o produto fica `INTERMEDIATE` + listado no catálogo.
- [x] Ficha normal continua PREP/SALE + `RECIPE_CONTROLLED` + oculta no catálogo + explosão na venda.
- [x] **Produzir N receitas** entra N × rendimento no intermediário e baixa N × cada insumo da ficha, com movimentos classificados como produção.
- [x] Venda / saída do intermediário baixa só o saldo dele; insumos da ficha não mexem.
- [x] Venda da ficha normal continua baixando só os insumos.
- [x] Intermediário usado como insumo de outra ficha: a produção/venda dessa outra ficha baixa o saldo do intermediário, sem explodir a ficha dele.
- [x] EPOC / saída de estoque do dia trata intermediário como item com saldo (não pula).
- [x] Card Configuração distingue ficha normal e produto intermediário.
- [x] Catálogo (card e tabela) e header do detalhe mostram o badge **Produção** só quando `stock_control_type = INTERMEDIATE`. Cor/ícone distintos de Agrupamento e de Ficha técnica. Sem o badge violeta “Ficha técnica” nesse produto.
- [x] Sem backfill de explosão ao criar intermediário.
- [x] RPCs de ficha/produção e `consume_recipe_stock` autorizam membro **e** admin Faro (`user_has_company_access`), não só `user_companies`.
- [ ] Verificar no browser: cadastrar ficha intermediária → produzir → ver saldo e saída dos insumos → vender → saldo do intermediário cai e insumos não mexem. Comparar com uma ficha normal no mesmo ambiente.

## Notas para a IA

- Reutilizar `recipes` + `recipe_ingredients` + `consume_recipe_stock`. Não criar tabela de BOM paralela.
- Reutilizar `PRODUCTION` em `recipe_type`. Não inventar outro enum de receita.
- Não reusar `COMPOSITE` nem marcar intermediário como `RECIPE_CONTROLLED` (a explosão na saída quebraria o fluxo).
- Estender `upsert_product_technical_sheet` (ou RPC irmã com flag de modo) em vez de duplicar o editor de insumos.
- `propagate_recipe_stock_on_output_out` e o backfill histórico são o caminho da ficha **normal**. Intermediário não entra aí.
- Evoluir o card **Baixa por preparo** para **Produzir** quando a receita for `PRODUCTION` (entrada no output). Não deixar o card antigo “só consome” agir em intermediário sem a entrada.
- Copy: badge e listas curtas = **Produção**. Texto longo / config = **produto intermediário**. Código interno: `INTERMEDIATE`.
- Reutilizar o `Badge` e o lugar dos rótulos de Agrupamento em `ProductCatalogCard` / `ProductCatalogTable` / header do sheet. Não criar outro componente de tag.
- Testes: upsert + produce + sale (intermediário vs PREP) e um caso em que o insumo é outro intermediário.
- Tabelas de dados: cabeçalhos com `SortableTableHead`. Sheet de produção/lista: cards só no celular.
