# Feature: Saldo de conta bancária em pt-BR

- **Slug:** `contas-bancarias-saldo-ptbr`
- **Status:** feita
- **Área:** `/app/configuracoes/contas-bancarias`

## Problema

No campo **Saldo atual**, o usuário digita no formato brasileiro (`20.213,88` ou `20.000,00`) e, ao salvar, o valor fica cerca de 100 vezes maior (`R$ 2.021.388,00`). O parser remove os pontos (milhar) e depois `parseOpeningBalance` remove o ponto decimal que restou.

## Objetivo

Digitar e salvar saldo no formato brasileiro (ponto de milhar, vírgula decimal) grava o valor certo. Reabrir e salvar sem alterar não multiplica o saldo.

## Fora de escopo

- Corrigir saldos já gravados errados no banco.
- Máscara de centavos (só dígitos).
- Alterar importação OFX.

## Contexto no código

- Páginas / rotas: `web/src/pages/ConfiguracoesContasBancarias.tsx`
- Hooks / libs: `web/src/lib/formatMoneyPtBr.ts`, `parseOpeningBalance` em `web/src/lib/cashFlowSimulation/computeCashFlowProjection.ts`
- Backend: coluna `current_balance` em `company_bank_accounts`

## Comportamento esperado

- `20.213,88` e `R$ 20.213,88` → 20213.88
- `20.000,00` / `20.000` → 20000
- Valor já normalizado `20213.88` também lê certo
- Ao sair do campo, o texto fica `20.213,88`

## Critérios de aceite

- [x] Salvar `20.213,88` grava 20213.88, não 2021388
- [x] Editar e salvar de novo sem mudar o campo não altera o saldo
- [x] Campo vazio continua saldo nulo
- [ ] Verificar no browser o fluxo principal (não só screenshot)

## Notas para a IA

Não chamar `parseOpeningBalance` depois de já ter feito `replace(/\./g, "").replace(",", ".")`. Reutilizar `parseMoneyPtBr`.
