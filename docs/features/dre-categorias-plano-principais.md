# Feature: DRE só com contas principais no padrão

- **Slug:** `dre-categorias-plano-principais`
- **Status:** feita
- **Área:** `/app/configuracoes/categorias`

## Problema

Unidades no plano antigo (v3) nascem com dezenas de subcategorias padrão. O desejado é só contas principais no seed; cada unidade cria e remove subcategorias. A árvore deve abrir recolhida e o financeiro (permissão Configurações) poder remover subcategorias.

## Objetivo

Plano padrão = 11 contas principais. Subcategorias só por configuração da unidade. Unidades antigas perdem filhos padrão sem uso; os em uso ficam removíveis.

## Fora de escopo

- Remapear lançamentos entre categorias.
- Árvore do relatório `/app/dre`.
- Renomear raízes v3 → v4.
- Checar nome do perfil “Financeiro”.

## Contexto no código

- Páginas: `web/src/pages/ConfiguracoesCategorias.tsx`
- Libs: `web/src/lib/companyCategories/financialSeedV4.ts`
- Seed: `seed_financial_categories_v4`
- Migration: limpeza de filhos `padrao_sistema` sem uso
- Trigger: `company_categories_prevent_delete_default` (só raízes padrão)

## Comportamento esperado

- Unidade nova: só as 11 contas principais.
- Unidade antiga: filhos padrão sem uso apagados; em uso com `padrao_sistema = false`.
- UI: árvore recolhida; lixeira só em subcategorias se `canManage`.
- Após criar subcategoria, o pai fica expandido.

## Critérios de aceite

- [x] Seed / nova unidade sem subcategorias padrão
- [x] Migration remove filhos padrão sem uso
- [x] Filhos em uso ficam e podem ser removidos na UI
- [x] Árvore inicia recolhida
- [x] Lixeira só em subcategorias (não em raízes)
- [ ] Verificar no browser o fluxo principal (não só screenshot)

## Notas para a IA

`canManage` = `useCanManageFinancialCadastro()` (permissão `configuracoes`). Não apagar raízes `padrao_sistema`. A migration só mexe em filhos com `padrao_sistema = true`; categorias criadas pela unidade (`padrao_sistema = false`) permanecem.
