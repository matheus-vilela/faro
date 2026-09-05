# Feature: Estoque vs vendas EPOC do dia

- **Slug:** `epoc-estoque-vs-vendas`
- **Status:** feita
- **Área:** `/app/desenvolvimento` · aba EPOC · seção Estoque

## Problema

Saídas no `mod_rel_estoque` podem não ter venda correspondente em `mod_rel_produto_sintetico` no mesmo dia (ficha, cortesia, baixa sem cupom). Hoje as duas consultas são manuais e o cruzamento é no olho.

## Objetivo

Num card, o admin escolhe um dia, o Faro busca vendas e depois estoque, mostra as duas tabelas e lista os itens de estoque (Saída) que não aparecem na venda de produtos.

## Fora de escopo

- Persistir o cruzamento.
- Comparar quantidades ou custos (só presença).
- O inverso (venda sem estoque).
- Mudar os cards avulsos de venda/estoque.

## Contexto no código

- `web/src/services/epocVendaProdutosExportService.ts`
- `web/src/services/epocEstoqueExportService.ts`
- `web/src/lib/epocProdutoVendasInterpret.ts` (`epocExactNameKey`, parse do CSV)
- `web/src/pages/Desenvolvimento.tsx`
- Regras: `.cursor/rules/tabelas-e-sheets.mdc`

## Comportamento esperado

1. Data (default ontem) + **Comparar dia**.
2. Primeiro venda de produtos do dia; depois estoque (Saída).
3. Dia sem `#tblExport` em vendas = lista vazia, não erro fatal.
4. Match: nome normalizado (`epocExactNameKey`). Se o CSV de venda tiver coluna de código/SKU, também casa por SKU.
5. Três blocos: vendas, saídas de estoque, **só no estoque**.
6. Tabelas com cabeçalho ordenável.

## Critérios de aceite

- [x] Card na seção Estoque da aba EPOC.
- [x] Exibe as duas tabelas após as consultas.
- [x] Lista só o que está no estoque e não na venda.
- [x] Venda sem tabela no dia não quebra o fluxo.
- [x] Teste do cruzamento (nome com acento + SKU opcional).

## Notas para a IA

Reutilizar as edge functions já existentes. Não chamar o portal de novo com HTML novo.
