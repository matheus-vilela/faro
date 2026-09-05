# Feature: Consulta de estoque EPOC do dia

- **Slug:** `epoc-estoque-dia`
- **Status:** feita
- **Área:** `/app/desenvolvimento` · aba EPOC

## Problema

Não há ferramenta de desenvolvimento para puxar o relatório `mod_rel_estoque` de um dia e ver as saídas com SKU, categoria, quantidades e custo. Hoje isso só existe no portal, em HTML hierárquico (`#tblExport`).

## Objetivo

Na aba EPOC, o admin escolhe um dia, consulta o portal com as credenciais da unidade e vê (e baixa) só as linhas de **Saída**.

## Fora de escopo

- Importar ou persistir o estoque no Faro.
- Outras ações (Estorno, Entrada, Baixa, etc.).
- Intervalo de vários dias.
- Gravar cookie/token de sessão capturado no browser.

## Contexto no código

- Páginas / rotas: `web/src/pages/Desenvolvimento.tsx` (aba EPOC)
- Padrão de card: `web/src/components/desenvolvimento/EpocVendaProdutosExportCard.tsx`
- Login/portal: `supabase/functions/_shared/epocPortalLoginSession.ts`, `epocPortalFetch.ts`
- HTML: `supabase/functions/_shared/epocHtmlExtract.ts`
- Regras: `.cursor/rules/tabelas-e-sheets.mdc`, `.cursor/rules/features.mdc`

## Comportamento esperado

1. Card **Estoque do dia**: data (default ontem, America/Sao_Paulo) + botão consultar.
2. Backend: login EPOC → `validadorOz.php` → `acoes.php` (`modulo=mod_rel_estoque`, `action=FILTRAR`). Este módulo **não** tem `ConteudoTela`; o critério de sucesso é `#tblExport`.
3. Extrai `#tblExport`, mantém a hierarquia de grupos (`1 - BEBIDAS` → `1.1 - SOFT` → `1.1.2 - AGUAS`) e só as linhas cuja ação é Saída.
4. Item no formato ` - SKU - NOME`.
5. Tela: tabela ordenável (SKU, item, categorias, qtde, qtde por volume de saída, custo total) + download CSV.

## Critérios de aceite

- [x] Card na aba EPOC, sem token/cookie hardcoded.
- [x] Só itens com ação Saída; Estorno não entra.
- [x] Categorias vêm da hierarquia do HTML.
- [x] Cabeçalhos ordenáveis (`SortableTableHead` + `useClientTableSort`).
- [x] Parser coberto por teste com o HTML de exemplo.

## Notas para a IA

Não commitar `PHPSESSID` nem o `token` do curl. Usar usuário/senha de `company_integrations` (provider `epoc`). `NaoMenu` = `codigo_filial` ou `123A`.
