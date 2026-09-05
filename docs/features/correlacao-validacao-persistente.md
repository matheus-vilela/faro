# Feature: Validação da correlação sobrevive à troca de aba

- **Slug:** `correlacao-validacao-persistente`
- **Status:** em-andamento
- **Área:** `/app/produtos` (Correlação)

## Problema

Ao clicar em **Iniciar validação** na aba Correlação e mudar para outra área (Catálogo, Estoque, Fichas…), o fluxo desmonta. A busca em andamento e a resposta da IA somem. Ao voltar, o usuário vê de novo o card inicial, mesmo com a correlação ainda processando ou já pronta.

## Objetivo

A busca e a resposta da validação ficam no contexto da sessão: ao voltar para Correlação, as sugestões já aparecem carregadas ou, se ainda estiver processando, a tela de espera continua.

## Fora de escopo

- Persistência após F5, fechar o navegador ou outra aba do browser.
- Gravar o resultado da IA no servidor.
- Manter sheets/dialogs abertos (unificar produto, ficha técnica).
- Alterar o contrato da função `correlate-sold-purchased`.

## Contexto no código

- Páginas / rotas: `web/src/pages/ProdutosHome.tsx`, `web/src/components/ProdutosEstoqueLayout.tsx` (`<Outlet />` desmonta a aba)
- Componentes: `web/src/components/products/ProductValidationFlow.tsx`
- Hooks / libs: `web/src/lib/productValidation/invokeCorrelateSoldPurchased.ts`
- Backend: sem mudança
- Regras Cursor relacionadas: `docs/features/_template.md`

## Comportamento esperado

- Clicar em Iniciar validação (ou Rodar de novo) grava o estado da sessão por empresa.
- Trocar de aba não cancela a chamada em andamento.
- Voltar com a busca ainda rodando mostra “Interpretando vendidos e comprados”.
- Voltar com a busca concluída mostra as sugestões e as seleções já feitas.
- Trocar de empresa usa a sessão da empresa atual (não mistura resultados).

## Critérios de aceite

- [x] Iniciar validação, sair da aba e voltar ainda processando: mostra o estado de espera, sem pedir para iniciar de novo.
- [x] Iniciar validação, sair, esperar o fim e voltar: sugestões aparecem sem novo clique.
- [x] Seleções de vínculo/ficha feitas antes de sair continuam marcadas.
- [x] Empresa A e empresa B têm sessões independentes.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Não use keep-alive de todas as rotas de produtos. Persistência em memória por `companyId` (módulo + subscribe) basta: o `<Outlet />` pode continuar desmontando a página.
