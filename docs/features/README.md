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
| `correlacao-colunas-multi-nota.md` | PDV à esquerda, várias notas à direita na correlação |
| `correlacao-corrigir-filtros-tipos.md` | Filtros e tipos atuais em «Para corrigir» |
| `agrupamento-tres-opcoes.md` | Detalhe: três papéis de agrupamento + destino à parte |
| `produto-detalhe-agrupamento-info.md` | Card de infos do agrupamento no detalhe do produto |
| `ficha-normal-sem-preparo.md` | Ficha de venda não se produz; só a de produção |
| `checklist-sidebar.md` | Checklists: tabs viram sidebar no padrão de Produtos |
| `contas-a-pagar-sidebar.md` | Contas a pagar: calendário e listagem na sidebar |
| `checklist-historico-filtro-periodo.md` | Histórico: filtro de mês + de/até como em Notas |
| `contas-filtro-padrao.md` | Contas: calendário e listagem com filtro de Notas |
| `correlacao-mesmo-item-ou-ficha.md` | Match da IA: unificar **ou** ficha (dose × garrafa) |
| `correlacao-configurar-papel.md` | Card de confirmação: papel do vendido (produto, ficha, agrupamento, variante) |
| `correlacao-variante-criar-agrupamento.md` | Variante em «Para corrigir»: cadastrar agrupamento que ainda não existe |
| `correlacao-variante-seletor-criar.md` | Variante: criar agrupamento no próprio seletor, sem campo extra |
| `correlacao-corrigir-badges.md` | «Para corrigir»: uma badge de origem; volume só na coluna |
| `correlacao-corrigir-origem-agrupamento.md` | Badge PDV/nota; possível agrupamento já selecionado |
| `correlacao-corrigir-somente-estoque.md` | «Para corrigir»: tag Somente estoque ao lado da origem |
| `correlacao-direita-por-papel.md` | Card de correlação: direita muda com o papel (ficha no card) |
| `correlacao-2.md` | Aba Correlação 2: fila + inspector, sem corte de 90% |
| `correlacao-2-variante-fila.md` | Variante já ligada não volta na fila da Correlação 2 |
| `vendas-calendario-abas.md` | Vendas: Calendário com abas internas calendário / listagem |
| `ncm-rpc-acesso-admin.md` | Aba NCMs: admin Faro deixa de levar «Acesso negado» |
| `unificar-com-produto.md` | Unificar com qualquer produto; hub não inverte |
| `produto-ultimo-preco-por-unidade.md` | Detalhe: último preço + proporcional por unidade de estoque |
| `produto-fornecedores-nfe-staging.md` | Aba Fornecedores inclui emitente de `nfe_staging_create` |
| `movimentacao-detalhe-nfe.md` | Detalhe da movimentação: nota, fornecedor, qtd e item original |
| `conversao-unidade-dialog-sheet.md` | Diálogo de conversão clicável acima do sheet do produto |
| `<slug>.md` | Task real (rascunho → pronta → em-andamento → feita) |

Convenções permanentes (tabelas, sheets, etc.) ficam em `.cursor/rules/`, não aqui.

Modelo de produto / correlação: `docs/dominio/`.
