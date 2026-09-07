# Feature: Validar CNPJ e nome único das unidades

- **Slug:** `unidade-cnpj-nome`
- **Status:** feita
- **Área:** `/empresas` (cadastro e edição de unidades)

## Problema

O cadastro de unidade aceita CNPJ com 14 dígitos sem conferir os dígitos verificadores. Dá para gravar um número quase igual ao correto (ex. `…0001-88` em vez de `…0001-85`). O nome da unidade também pode repetir: a unicidade no banco é só no mesmo grupo, então o mesmo nome em outro grupo (ou na criação, sem checagem no wizard) passa.

## Objetivo

Só entra unidade com CNPJ matematicamente válido. O mesmo dono não cadastra duas unidades com o mesmo nome nem com o mesmo CNPJ.

## Fora de escopo

- Corrigir automaticamente CNPJs inválidos já gravados.
- Permitir alterar o CNPJ na edição (continua bloqueado).
- Unicidade de nome entre donos diferentes (multi-tenant).

## Contexto no código

Arquivos e peças que a IA deve abrir primeiro:

- Páginas / rotas: `web/src/pages/Companies.tsx`
- Componentes: `web/src/components/unit-setup/UnitSetupWizard.tsx`
- Hooks / libs: `web/src/lib/cnpj.ts`, `web/src/lib/companyUnitName.ts`, `web/src/lib/setup/validation.ts`
- Backend (tabelas, RPCs, functions): `web/src/services/unitSetupService.ts`, `web/src/services/focusConsultaCnpjService.ts`, `supabase/functions/focus-consulta-cnpj/index.ts`
- Regras Cursor relacionadas: —

## Comportamento esperado

- Consulta na Receita e gravação recusam CNPJ com dígitos verificadores inválidos.
- Criação e edição recusam nome igual (trim + minúsculas) em qualquer unidade do mesmo dono.
- Criação recusa CNPJ já usado em outra unidade do mesmo dono.

## Critérios de aceite

- [x] CNPJ `47774895000188` é recusado; `47774895000185` (dígitos corretos do mesmo raiz) é aceito na validação local.
- [x] Não dá para criar segunda unidade com o mesmo nome fantasia, mesmo em outro grupo do mesmo dono.
- [x] Não dá para criar segunda unidade com o mesmo CNPJ do mesmo dono.
- [x] Mensagens deixam claro se o problema é CNPJ inválido, nome repetido ou CNPJ repetido.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Reutilizar `isValidCnpj` (já usado em fornecedores). Não inventar outro algoritmo. Unicidade de nome no banco continua por grupo; a regra extra (mesmo dono, qualquer grupo) é no wizard/serviço.
