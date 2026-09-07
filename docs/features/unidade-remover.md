# Feature: Remover unidade sem erro genérico

- **Slug:** `unidade-remover`
- **Status:** feita
- **Área:** `/empresas`

## Problema

Ao confirmar «Remover unidade», aparece só **Erro ao remover unidade**. O `DELETE` direto em `companies` dispara CASCADE em dezenas de tabelas filhas: RLS do filho pode bloquear (ex. `user_companies` some primeiro) e FKs `ON DELETE RESTRICT` (família de venda, categorias de receita, extrato bancário) competem com o CASCADE.

## Objetivo

O dono do grupo, o dono da unidade ou o admin Faro consegue excluir a unidade. Se falhar, a mensagem descreve a causa.

## Fora de escopo

- Apagar o grupo automaticamente quando fica vazio.
- Desfazer exclusão.
- Mudar a ordem Focus vs Faro (Focus continua antes, se houver `id_empresa`).

## Contexto no código

Arquivos e peças que a IA deve abrir primeiro:

- Páginas / rotas: `web/src/pages/Companies.tsx`
- Componentes: diálogo «Remover unidade?»
- Hooks / libs: `web/src/lib/companyUnitName.ts` (`mapCompanyUnitMutationError`)
- Backend (tabelas, RPCs, functions): RPC nova `delete_company_unit`; trigger `companies_before_delete_set_category_cascade`
- Regras Cursor relacionadas: —

## Comportamento esperado

- Exclusão via RPC `SECURITY DEFINER` (bypassa RLS nas filhas) depois de checar permissão.
- Antes do `DELETE` da unidade, apaga linhas que travam por `RESTRICT`.
- Liga o bypass de categoria padrão (`app.company_delete_cascade`).
- Erro do banco não vira fallback genérico se houver `message`/`details`.

## Critérios de aceite

- [x] Dono consegue remover uma unidade com dados vinculados (produtos, categorias, etc.).
- [x] Quem não é dono/admin recebe «Sem permissão…», não o fallback genérico.
- [x] Falha de banco mostra o texto do Postgres (ou a mensagem de FK), não só «Erro ao remover unidade».
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Não usar `supabase.from("companies").delete()` no cliente. Reutilizar `is_platform_admin()` e o GUC do trigger de categorias.
