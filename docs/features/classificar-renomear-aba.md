# Feature: Aba Classificar

- **Slug:** `classificar-renomear-aba`
- **Status:** feita
- **Área:** `/app/produtos`

## Problema

O nome **Correlação** descreve o cruzamento PDV × nota, não o que a pessoa faz: decidir o papel de cada cadastro (unificar, ficha, agrupamento, insumo).

## Objetivo

A aba e o título da tela passam a **Classificar**.

## Fora de escopo

- Mudar rotas (`/app/produtos`, `correlacao-2`).
- Renomear arquivos, RPCs ou o domínio interno.
- Reescrever specs antigas.

## Contexto no código

- `web/src/components/ProdutosEstoqueLayout.tsx`
- `web/src/pages/ProdutosHome.tsx`
- `web/src/lib/documentTitle.ts`
- `web/src/components/dashboard/DashboardQuickLinks.tsx`
- `web/src/components/products/ProductValidationFlow.tsx`

## Comportamento esperado

- Menu, título da página e título do browser: **Classificar**.
- Textos da tela que falavam «correlação» como nome da etapa usam classificar.

## Critérios de aceite

- [x] Aba e página dizem Classificar.
- [x] Documento do browser em `/app/produtos` diz Classificar.
- [ ] Verificar no browser o menu e o cabeçalho.

## Notas para a IA

Não trocar «correlação» em adquirente, nem em docs de domínio.
