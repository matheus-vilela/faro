# Feature: Tabela na hora, IA opcional

- **Slug:** `correlacao-tabela-antes-da-ia`
- **Status:** em-andamento
- **Área:** `/app/produtos` (Correlação)

## Problema

A tabela só aparece depois de «Iniciar validação». Sem a IA a pessoa não vê a fila. A Correlação 2 já mostrava que o cadastro sozinho já sugere ficha, unificar ou insumo.

## Objetivo

Abrir a Correlação já na tabela, com intent local. Acima, um bloco para a IA ler só os itens ainda sem configuração.

## Fora de escopo

- Mudar o contrato `correlate-sold-purchased`.
- Rodar a IA sozinha ao entrar na tela.
- Sobrescrever o seletor que a pessoa já trocou.

## Contexto no código

- `web/src/components/products/ProductValidationFlow.tsx`
- `web/src/lib/productValidation/session.ts`
- `web/src/lib/productValidation/invokeCorrelateSoldPurchased.ts`
- `web/src/components/products/correlacao2/CorrelationCaseWorkbench.tsx`

## Comportamento esperado

- Com fila e onboarding ok: tabela na hora (`result` pode ser null).
- Bloco acima: verificar com IA os itens ainda sem leitura e sem troca manual.
- Enquanto a IA roda, o lugar da tabela vira loading com animação e pedido para aguardar.
- Resultado novo mescla com o anterior; não apaga pares já lidos.
- Item com intent da IA leva a tag **Pela IA** ao lado da origem, sem percentual.
- Onboarding incompleto e fila vazia ficam como hoje.

## Critérios de aceite

- [x] Sem clicar na IA a tabela já lista a fila com intent local.
- [x] O clique só envia itens ainda abertos (sem leitura da IA e sem o usuário ter trocado o seletor).
- [x] Durante a verificação a tabela mostra loading e pede para aguardar.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Reutilizar `suggestIntent`, `startProductValidationSession` e o workbench. Não inventar segundo apply.
