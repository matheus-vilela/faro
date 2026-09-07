# Feature: Nome da ficha sem sufixo na RPC

- **Slug:** `ficha-nome-sem-sufixo-rpc`
- **Status:** feita
- **Área:** `/app/produtos/fichas`

## Problema

A RPC grava `Nome — ficha técnica` / `— produção`. Mudar o rascunho no front não adianta: o save sobrescreve. O tipo já aparece na UI (abas, badges).

## Objetivo

O nome persistido é só o nome do produto/receita. Tipo de ficha só no front.

## Fora de escopo

- Mudar o editor de insumos ou o CMV.
- Renomear produtos de saída.

## Contexto no código

- `supabase/migrations/20260905130000_product_intermediate.sql` — `upsert_product_technical_sheet`
- `web/src/components/estoque/EstoqueReceitasPanel.tsx`
- `web/src/lib/productTechnicalSheet.ts`

## Comportamento esperado

- RPC grava `recipes.name` sem sufixo.
- Fichas já gravadas com ` — ficha técnica` / ` — produção` perdem só esse sufixo.
- Front não concatena ` — ficha` no rascunho.

## Critérios de aceite

- [x] Salvar ficha técnica não acrescenta sufixo no nome.
- [x] Lista mostra o nome sem ` — ficha técnica`.
- [x] Tipo continua visível pelas abas / badges.
- [ ] Verificar no browser o fluxo principal (não só screenshot).
