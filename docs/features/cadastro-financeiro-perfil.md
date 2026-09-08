# Feature: Cadastro financeiro no perfil com Configurações

- **Slug:** `cadastro-financeiro-perfil`
- **Status:** feita
- **Área:** `/app/configuracoes/categorias`, `/app/configuracoes/contas-bancarias`

## Problema

Categorias (DRE, produtos, NCM) e contas bancárias só o proprietário consegue alterar. Colaborador com perfil que inclui **Configurações** (quem usa o grupo Financeiro em Configurações) entra nas telas, mas os botões ficam ocultos ou desabilitados.

## Objetivo

Quem tem a permissão `configuracoes` (proprietário, admin Faro ou colaborador com essa seção no perfil) edita categorias e cria/edita/remove contas bancárias.

## Fora de escopo

- Promover colaborador a proprietário.
- Liberar usuários e acessos, impostos na receita, WhatsApp ou integrações.
- Novo tipo de perfil no banco (nome “Financeiro”); vale a chave de permissão já existente.

## Contexto no código

- `web/src/lib/permissions.ts` — `canManageFinancialCadastro`
- `web/src/contexts/CompanyContext.tsx` — `useCanManageFinancialCadastro`
- `web/src/pages/ConfiguracoesCategorias.tsx`
- `web/src/pages/ConfiguracoesCategoriasProdutosPanel.tsx`
- `web/src/pages/ConfiguracoesCategoriasNcmsPanel.tsx`
- `web/src/pages/ConfiguracoesContasBancarias.tsx`
- RLS de `company_categories` e `company_bank_accounts` já permite membro da unidade; o bloqueio era só na UI.
- `supabase/migrations/20260908220000_ncm_category_rules_member_write.sql` — gravação de NCM deixa de ser só owner.

## Comportamento esperado

- Perfil com `configuracoes`: criar/editar/remover categorias do DRE, categorias de produto, vínculo NCM e contas bancárias.
- Perfil sem `configuracoes`: não altera (mesmo se chegar na rota).
- Proprietário e admin Faro continuam com acesso total.

## Critérios de aceite

- [x] Colaborador com `configuracoes` vê e usa Nova categoria, editar e remover no DRE.
- [x] O mesmo colaborador cria e edita conta bancária.
- [x] Colaborador sem `configuracoes` não persiste alterações.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Não checar nome do perfil (“Financeiro”). Usar `hasPermission(..., "configuracoes")`. Não exigir `role === owner` nessas telas.
