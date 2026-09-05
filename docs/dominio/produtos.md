# Produtos, fichas, agrupamentos e correlação

## Papéis (não misturar)

Um cadastro de `products` é **um** destes mecanismos de estoque. Variante de agrupamento é o mesmo produto **mais** um vínculo; não é um `stock_control_type` exclusivo.

| Papel | `stock_control_type` | Receita | O que acontece |
|---|---|---|---|
| Produto (insumo / garrafa / SKU) | `DIRECT` (padrão) | — | Compra entra saldo. Venda ou uso baixa o saldo 1:1. |
| Ficha normal (prato, dose, porção) | `RECIPE_CONTROLLED` | `PREP` / `SALE` | **Não se produz.** Só existe para, na venda, baixar insumos na proporção da receita. Some do catálogo (`listed_in_product_catalog = false`). |
| Ficha de produção (intermediário) | `INTERMEDIATE` | `PRODUCTION` | **Pode produzir:** baixa insumos e entra saldo. A venda baixa só o intermediário. Fica no catálogo. |
| Agrupamento | `SALE_FAMILY` no cardápio | — | Item de venda (EPOC/PDV) sem estoque próprio. A baixa vai nas **variantes** (proporção). Não é ficha. |
| Variante | produto real (`DIRECT` ou `INTERMEDIATE`) + vínculo | — | SKU com estoque, ligado a um agrupamento. |
| Serviço | `SERVICE` | — | Sem estoque. Fora da correlação de nota × PDV. |

Não usar `COMPOSITE`. Não transformar agrupamento em ficha, nem o contrário.

### Exemplos

- **GIN TANQUERAY** (garrafa 500 ml, veio da nota) → produto `DIRECT`. Tem saldo.
- **DS GIN TANQUERAY** (dose no PDV, “DS” = dose) → **ficha normal**. A venda baixa 30 ou 50 ml da garrafa. **Não unificar** com a garrafa: são cadastros diferentes (um vende porção, o outro estoca o litro).
- **Caipirinha** → ficha normal; insumos (cachaça, limão) saem na venda.
- **Molho de tomate** produzido e estocado → intermediário; insumos saem na **produção**.
- **Bolinho** no cardápio + **Bolinho queijo / carne** no estoque → agrupamento + variantes.

## Insumo não é um tipo

Insumo **não** é um `stock_control_type` nem uma opção do vendido no PDV. É um produto `DIRECT` (às vezes um intermediário) **usado numa receita**. Na correlação, o item da nota vira insumo quando o vendido é ficha — não se “marca o vendido como insumo”.

## O que cada um pode

- Ficha normal: cadastrar insumos e vender. Sem Produzir/Preparar.
- Intermediário: produzir (baixa insumos + entra saldo) e vender o saldo.
- Produto `DIRECT`: comprar, ajustar, ser insumo, ser variante.
- Agrupamento: só vender o nome do cardápio; estoque nas variantes.
- Unificar: **mesmo item de estoque** com dois cadastros (PDV e nota, ou dois fornecedores). Junta saldo, EAN, histórico.

### Quem pode unificar

Pode: produto `DIRECT` ↔ `DIRECT`; intermediário ↔ intermediário do mesmo SKU; variante (continua sendo produto) ↔ outro cadastro do **mesmo SKU**.

Não pode: ficha normal (`RECIPE_CONTROLLED`) com a nota; agrupamento (`SALE_FAMILY`) com a nota; ficha com produto. Dose/prato (ex. «DS GIN») e a garrafa da NF são cadastros diferentes.

## Correlação (PDV × nota)

A IA só **propõe** um vínculo. Nome parecido ≠ mesmo cadastro.

Caminhos corretos para um par «vendido (esquerda) × compra(s) da nota (direita)»:

1. **Mesmo item** → Unificar. Ex.: «Gin Tanqueray» no PDV e o mesmo gin na NF.
2. **Ficha normal** → o vendido é dose/prato. À direita abre o fluxo de ficha (buscar insumo, quantidade e unidade). A nota pode pré-preencher o insumo com qtde vazia — não unificar. Ex.: DS GIN × GIN TANQUERAY 500 ml.
3. **Intermediário** → o vendido é produzido e estocado. À direita o mesmo fluxo de ficha, tipo produção. A nota não unifica.
4. **Agrupamento / variante** → cardápio sem estoque × SKUs reais. Não é unificar nem ficha.
5. **É um produto interno** → sem par; fica `DIRECT` e sai da fila.
6. **Insumo de ficha** (só compra) → entra numa ficha já existente, sem unificar com o prato.

Um vendido pode ter **várias** compras da nota (fornecedores/EANs). No mesmo item, unificar em sequência. Na ficha, todas viram insumos.

Confiança alta da IA ainda exige confirmação. Prefixo tipo DS, DOSE, PORÇÃO, QT, UN (quando for unidade de consumo) é sinal de **ficha**, não de unificar.

## Onde está no código

- Correlação: `ProductValidationFlow`, `ProductValidationCards`, `productValidation/`
- Ficha: `EstoqueReceitasPanel`, `upsert_product_technical_sheet`, `propagate_recipe_stock_on_output_out`
- Produção: `produce_intermediate_product`
- Agrupamento: `productSaleFamily.ts`, RPCs `sale_family`
- Fila «Para corrigir»: `productSetupQueue.ts`, `ProductSetupActionPanel`
