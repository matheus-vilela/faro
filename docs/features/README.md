# Specs de feature

Cada arquivo aqui é o briefing de uma task **antes** de implementar. A IA lê o spec da feature em que está trabalhando — não o índice inteiro.

| Arquivo | Uso |
|---|---|
| `_template.md` | Copiar para um spec novo |
| `_exemplo.md` | Spec preenchido (já feito). Não implementar de novo |
| `epoc-estoque-dia.md` | Consulta de estoque EPOC do dia (aba Desenvolvimento) |
| `epoc-estoque-vs-vendas.md` | Cruzar saídas de estoque com venda de produtos do dia |
| `epoc-agrupamento-venda-estoque.md` | Agrupamento (Bolinhos) × variantes reais no estoque |
| `epoc-familia-venda-operacional.md` | Estoque no mesmo sync da venda de produtos + lista do dia |
| `produto-detalhe-configuracao.md` | Detalhe do produto: agrupamento, card de configuração, layout |
| `agrupamentos-sheet-variantes.md` | Sheet do agrupamento: variantes + incluir no mesmo painel |
| `produto-intermediario.md` | Ficha que produz e estoca (baixa insumos na produção, não na venda) |
| `fichas-tecnicas-layout.md` | Lista de fichas: busca, detalhe com histórico/produção |
| `ficha-produto-saida-nome.md` | Produto de saída: nome novo ou busca no catálogo |
| `producao-lotes.md` | Produzir: receitas × rendimento, resumo e confirmação |
| `catalogo-filtros-tipo.md` | Catálogo: tipo, categoria, alerta e barra compacta |
| `correlacao-validacao-persistente.md` | Validação da correlação sobrevive à troca de aba |
| `<slug>.md` | Task real (rascunho → pronta → em-andamento → feita) |

Convenções permanentes (tabelas, sheets, etc.) ficam em `.cursor/rules/`, não aqui.
