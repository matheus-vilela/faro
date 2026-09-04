# Feature: Agrupamento × baixa real no estoque (EPOC)

- **Slug:** `epoc-agrupamento-venda-estoque`
- **Status:** feita
- **Área:** cadastro de produtos + import EPOC (venda e estoque)
- **Nome no produto:** **agrupamento** (item de cardápio). Membros = **variantes** (item de estoque). Código interno continua `sale_family`. Não confundir com categoria financeira (`is_grouping`).

## Ficha técnica ≠ agrupamento

São dois mecanismos. Não misturar.

| | **Ficha técnica** | **Agrupamento** |
|---|---|---|
| Exemplo | `Caipirinha` | `Bolinhos` |
| O que o cliente pede | Sempre o mesmo prato/drink | Um item de cardápio; o **sabor/variante** ele escolhe na hora |
| Cadastro | Lista **fixa** de insumos + quantidade | Várias variantes possíveis (cupim, carne, queijo, …) |
| Na venda | Sempre baixa **todos** os insumos da ficha | **Não** baixa o `Bolinhos` e **não** explode as 10 variantes |
| Quem decide o estoque | A receita (sempre igual) | O cliente naquele pedido. Só o relatório de estoque do dia diz o que saiu |
| Dia A | Caipirinha → cachaça + limão + açúcar | Vendeu Bolinhos → estoque mostra 3× bolinho de **carne** → baixa só carne |
| Dia B | Caipirinha → **os mesmos** insumos | Vendeu Bolinhos de novo → estoque mostra 3× bolinho de **cupim** → baixa só cupim |

Ficha = composição **obrigatória e estável**.  
Agrupamento = um nome na venda, **N produtos reais** no cadastro; no dia só movimentam as variantes que o cliente pediu.

Pode existir os dois no mesmo estabelecimento: `Caipirinha` (ficha) e `Bolinhos` (agrupamento). `Cachaça` só no estoque costuma ser insumo de ficha, não variante de Bolinhos — por isso o vínculo do agrupamento é **manual**.

## Problema

O EPOC, na **venda de produtos**, devolve o nome de cardápio (`Bolinhos`). As variantes reais (`Bolinho de cupim`, `de carne`) só aparecem no **estoque**.

Hoje o Faro trata `Bolinhos` como produto e, no `product_sale`, **baixa o estoque de Bolinhos**. Errado: Bolinhos não é item físico. A baixa correta é a saída do dia (carne **ou** cupim **ou** os sabores que pediram).

A ficha **não resolve**: se `Bolinhos` virasse ficha com 10 sabores, **toda** venda baixaria os 10. Não é o caso.

## Objetivo

`Bolinhos` vira **agrupamento**. As 10 (ou N) variantes ficam como produtos de estoque, só vinculadas a ele. Venda de `Bolinhos` = receita e histórico, **sem baixa**. Estoque do dia = baixa só o que saiu (ex. 3 carne). Outro dia pode ser só cupim.

## Exemplo (dois dias)

Cadastro: agrupamento `Bolinhos` com variantes carne, cupim, queijo, … Proporção de cadastro (ex. 1 Bolinhos = 3 bolinhos de um sabor). **Não** explode na venda.

**Dia 1 — cliente pediu carne**

| Fonte | Item | Qtde | Faro |
|---|---|---|---|
| Venda | Bolinhos | 1 | Receita. Não baixa Bolinhos. Não baixa cupim/queijo. |
| Estoque | Bolinho de carne | 3 UN | Baixa 3 em carne. |

**Dia 2 — cliente pediu cupim**

| Fonte | Item | Qtde | Faro |
|---|---|---|---|
| Venda | Bolinhos | 1 | Receita de novo. Sem baixa no cardápio. |
| Estoque | Bolinho de cupim | 3 UN | Baixa 3 em cupim. Carne não mexe. |

A proporção (3 por 1) é metadado: conferir depois se “1 Bolinhos × 3 ≈ 3 carne”. **Não** gera movimento.

## Fora de escopo (nesta entrega)

- Transformar agrupamento em ficha (`recipe_type` SALE/PREP) ou baixar todas as variantes na venda.
- Inferir sozinho que “só no estoque” = variante (pode ser insumo de ficha, cortesia, perda).
- Estorno/entrada do relatório de estoque.
- Recalcular vendas EPOC já importadas.
- CMV no momento da venda do agrupamento (CMV nasce na baixa da variante daquele dia).

## O que já existe e o que é novo

Fatos do código (não inventar outro caminho):

- Import EPOC de **venda** casa/cria por coluna **Codigo → `products.sku`**. Não casa por nome no job atual (`process-integration-csv-revenue-job`). Sempre `entry_mode: product_sale` — nunca `recipe_sale`.
- Essa venda **já baixa estoque 1:1** no produto vendido (`adjust_product_stock`, `reference_type = revenue_entry`). Saldo negativo é permitido. CMV nasce nessa venda.
- Relatório `mod_rel_estoque` **não persiste**. Só a ferramenta de Desenvolvimento lê o HTML.
- `products.stock_control_type`: `DIRECT` | `RECIPE_CONTROLLED` | `COMPOSITE` | `SERVICE`. EPOC cria como `DIRECT`. `COMPOSITE` **não tem** tabela de componentes.
- Ficha: `recipes` + `recipe_ingredients` + `output_product_id`. Baixa **sempre** os insumos (`consume_recipe_stock` / `propagate_recipe_stock_on_output_out`). `listed_in_product_catalog = false` esconde o prato.
- Heurística `epocCsvProductKindClassification` sugere RECIPE para combo/balde — **não cria estrutura**. Não usar isso para agrupamento.
- Card Estoque vs vendas: `listEstoqueSemVenda` (SKU ou nome normalizado). Só em memória. Candidatos a variante, não vínculo automático.

| Já existe | Novo |
|---|---|
| Ficha = explosão **fixa** na venda | Agrupamento = cardápio sem explosão; baixa só o que o estoque do dia trouxe |
| `stock_control_type` + `COMPOSITE` sem BOM | Valor novo (ex. `SALE_FAMILY`) + tabela de variantes. Não reusar ficha nem `COMPOSITE` |
| `product_sale` baixa o SKU vendido | Agrupamento: receita **sem** `adjust_product_stock` e sem CMV nesse SKU |
| Card **Estoque vs vendas** | Ações manuais: cadastrar variante e ligar ao agrupamento |

## Modelo proposto

Relação explícita. Sem `parent_id` solto. Sem `recipe_ingredients`.

### `products`

Preferir valor novo em `stock_control_type` (ex. `SALE_FAMILY`). Alternativa: `is_sale_family boolean` se não quisermos mexer no enum agora.

- `Bolinhos` = agrupamento. Não é item de estoque. Existe para casar Codigo/nome da venda e histórico.
- Fora de listagens de estoque / compra / alerta (`listed_in_product_catalog = false` ou equivalente).
- **Proibido** `RECIPE_CONTROLLED` / `COMPOSITE` no `Bolinhos`: a venda baixaria insumos fixos ou as 10 variantes.

### `product_sale_family_members` (nova)

| Coluna | Uso |
|---|---|
| `company_id` | Unidade |
| `family_product_id` | Item de cardápio (`Bolinhos`) |
| `variant_product_id` | Item de estoque (`Bolinho de carne`) |
| `qty_per_sale` | Proporção de cadastro (ex. 3). Default 1. Só metadado nesta fase. |
| unique `(family_product_id, variant_product_id)` | |

Regras:

- Variante **não** é agrupamento.
- Agrupamento **não** é variante de outro (nesta fase).
- Uma variante em **no máximo um** agrupamento (simplifica). Reabrir se um SKU servir a dois nomes de cardápio.
- Podem existir 10 variantes cadastradas; no dia **nenhuma, uma ou várias** saem — só as linhas do estoque.

## Comportamento de importação

### Venda de produtos (`product_sale`)

1. Casa pelo **Codigo → sku**. Se Codigo vazio, fallback por nome.
2. Se o produto é agrupamento (`SALE_FAMILY`):
   - Cria `revenue_entry` (e boletos de receita).
   - **Não** chama `adjust_product_stock`.
   - **Não** gera CMV a partir de Bolinhos.
   - **Não** percorre as variantes.
   - Anota que a baixa vem do estoque do dia.
3. Se é ficha (`recipe_sale` / `RECIPE_CONTROLLED`): fluxo **atual da ficha** — baixa todos os insumos. Intocado.
4. Se é produto normal: fluxo atual (baixa 1:1).

### Relatório de estoque (novo passo)

Para cada **Saída** do `#tblExport` do dia:

1. Casa por SKU EPOC, senão nome.
2. Se não existe: cria produto (SKU + nome). Vínculo ao agrupamento só se o usuário já tiver feito.
3. Se é **variante de agrupamento**: baixa essa variante (`reference_type` ex. `epoc_stock_report`). Não baixa as irmãs.
4. CMV na baixa da variante (custo médio dela).
5. Item que também está na venda (água, Heineken): **não** baixar de novo — a venda já baixou.
6. Insumo de ficha que só aparece no estoque: **não** tratar como variante, a menos que alguém vincule na mão.

### Ligação venda ↔ baixa

Por dia: `revenue_entry` de Bolinhos + `stock_movements` das variantes que **de fato** saíram. Sem inventar cupim no dia da carne.

## UI

Textos: “Agrupamento” / “Variante”. Não “família”, não “ficha”.

### 1. Lista de venda do dia (unificada)

O que só saiu no estoque **entra na mesma lista** de venda de produtos daquele dia, com flag **possível agrupamento**. Conciliar (vincular / criar agrupamento) a partir da linha. Detalhe em `epoc-familia-venda-operacional.md`.

Não criar receita para essa linha. Água (venda + estoque) = uma linha, sem a flag.

### 2. Cadastro do produto

- Agrupamento: “Item de cardápio. A venda não baixa estoque. As variantes saem pelo relatório de estoque do dia.” Lista das N variantes + proporção.
- Variante: “Faz parte do agrupamento Bolinhos (3 por 1).”
- Ficha técnica: tela e copy **separados**. Sem misturar ingredientes com variantes.

### 3. Catálogo

Agrupamento não entra em saldo/alerta. Variantes são produtos normais.

## Fases sugeridas

1. **Modelo + UI de vínculo** — agrupamento/variantes a partir de “só no estoque”. Sync ainda não muda.
2. **Venda não baixa agrupamento** — `create_revenue_entry` / import CSV. Ficha permanece como está.
3. **Importar saídas de estoque** — baixa só o que o dia trouxe, sem duplicar venda normal.
4. **CMV + conferência de proporção** — aviso se 1 Bolinhos × 3 ≠ soma do sabor daquele dia (não exige casar todos os sabores).

## Critérios de aceite (quando implementar)

- [x] Vender `Bolinhos` (agrupamento) não baixa Bolinhos nem as 10 variantes. (`adjust_product_stock` no-op em `revenue_entry`; `apply_epoc_stock_variant_outs` só toca variantes já ligadas.)
- [x] Receita/histórico de Bolinhos permanecem. (`create_revenue_entry` segue criando o lançamento.)
- [x] Dia com só carne no estoque baixa **só** carne; cupim intacto.
- [x] Outro dia com só cupim baixa **só** cupim.
- [x] Vender `Caipirinha` (ficha) continua baixando **todos** os insumos. (`recipe_sale` intocado.)
- [x] Água (venda + estoque) não leva baixa dupla. (Aplicar baixas ignora o que não é variante.)
- [x] “Só no estoque” não vira variante sozinho. (Vínculo só pelo botão.)
- [x] Proporção não gera movimento. (`qty_per_sale` é só cadastro.)

## O que foi implementado

- Migrations: `20260904140000_product_sale_family.sql`, `20260904140100_sale_family_skip_stock_check.sql` — aplicar no banco (`supabase db push`).
- Card **Estoque vs vendas**: vincular variante + aplicar baixas do dia.
- Cadastro do produto: seção **Agrupamento** (separada da ficha).
- Fase 4 (aviso de proporção 1×3 ≠ soma do dia) ficou para depois.
- Continuação operacional: `epoc-familia-venda-operacional.md` (página no catálogo + estoque no sync).

## Riscos / perguntas para revisão

1. Nome na UI: **agrupamento** + **variante**. Código interno: `sale_family`.
2. Vínculo sempre manual? (`Cachaça` só no estoque = ficha, não variante.)
3. CMV só quando o estoque do dia entrar. Se o sync falhar, receita sem CMV até reprocessar?
4. Uma variante em um agrupamento só?
5. Fase 1 só em Desenvolvimento, ou já no catálogo?
6. Fase 3 no `epoc-daily-sync` ou só botão até validar um mês?
7. Histórico já importado com baixa em Bolinhos: script depois?

## Notas para a IA (quando for implementar)

- Ficha e agrupamento são códigos e telas **distintos**. Não reusar `recipe_ingredients` / `consume_recipe_stock` para variantes.
- Na venda do agrupamento: zero baixa, zero loop nas variantes.
- Na baixa do estoque: só as linhas daquele dia.
- Reutilizar `epocExactNameKey`, `listEstoqueSemVenda`, parsers EPOC.
- `create_revenue_entry`: ignorar `adjust_product_stock` se for agrupamento (`SALE_FAMILY`); **não** alterar o ramo de `recipe_sale`.
- Variantes: SKU do estoque (` - 1028 - BOLINHO CUPIM`). Agrupamento: Codigo da venda, se existir; senão nome.
- Copy: **agrupamento** / **variante**. Nunca chamar de ficha nem de “família”.
