# Feature: Limpar dados da unidade em Ferramentas

- **Slug:** `ferramentas-limpar-unidade`
- **Status:** em-andamento
- **Área:** `/app/desenvolvimento` (Geral)

## Problema

A purga operacional só existe como script `psql`. Para zerar uma unidade de teste é preciso acesso ao banco.

## Objetivo

Na tela de Ferramentas, o admin Faro limpa todos os dados operacionais da unidade ativa e mantém a empresa + credenciais EPOC/Focus.

## Fora de escopo

- Apagar a company ou usuários/perfis de acesso.
- Purgar todas as unidades de uma vez.
- Limpar arquivos órfãos no Storage.

## Contexto no código

- `scripts/purge-company-operational-data.sql`
- `web/src/pages/Desenvolvimento.tsx`
- `web/src/components/desenvolvimento/SyncHistoryPurgeCard.tsx`
- `supabase/migrations/20260826150000_purge_company_sync_history.sql`

## Comportamento esperado

- Card na aba Geral, só admin Faro.
- Confirmação com o nome da unidade.
- Remove vendas, notas, despesas, boletos, produtos, movimentações, contas, jobs, histórico.
- Preserva `companies` (incl. `setup`), credenciais PDV em `company_integrations.settings`, setup Focus em `focusnfe`, membros/perfis.
- Re-semeia categorias financeiras e de produto. Onboarding fiscal/PDV fica concluído; sync idle.
- A purga pode apagar categorias de produto `padrao_sistema` (bypass de sessão, igual à exclusão da empresa) e as recria no seed.

## Critérios de aceite

- [x] Card visível em Ferramentas → Geral.
- [x] Sem o nome da unidade, não executa.
- [x] Depois da limpeza, a unidade existe e as credenciais EPOC/Focus permanecem.
- [x] Produtos, lançamentos e movimentações da unidade somem.

## Notas para a IA

Reutilizar a lista e as chaves do script. Função (não PROCEDURE com COMMIT) para `supabase.rpc`. Só `is_platform_admin()`.
