# Feature: Conversão de unidade clicável no sheet

- **Slug:** `conversao-unidade-dialog-sheet`
- **Status:** feita
- **Área:** `/app/produtos` · diálogo de conversão (detalhe, ficha, compras)

## Problema

O detalhe do produto é um **Sheet** (`z-50`). «Nova conversão» é um **Dialog** no mesmo `z-50`, e o select da unidade secundária também. Relato típico: o diálogo abre, mas não dá para escolher a unidade, digitar ou salvar — ou o diálogo fecha ao clicar no select.

## Objetivo

O diálogo de conversão fica acima do sheet e o select da unidade secundária é usável sem fechar o modal.

## Fora de escopo

- Permitir editar o fator de um par já cadastrado (hoje só adiciona/remove).
- Liberar pares travados do sistema (kg↔g↔mg, l↔ml).
- Incluir unidades personalizadas da empresa no select.

## Contexto no código

- `web/src/components/units/UnitConversionDialog.tsx`
- `web/src/components/products/ProductUnitConversionsSection.tsx`
- `web/src/components/ui/dialog.tsx` — `overlayClassName` / dismiss
- `web/src/components/ui/sheet.tsx` — `preventStackedDismiss`
- Padrão do projeto: `overlayClassName="z-[80]"` + `className="z-[80]"`

## Comportamento esperado

- Abrir «Adicionar conversão» no detalhe (sheet): overlay e conteúdo acima do sheet.
- Abrir o select «Unidade secundária»: lista visível e clicável; o diálogo não fecha.
- Salvar e cancelar respondem ao clique.

## Critérios de aceite

- [x] `UnitConversionDialog` usa `z-[80]` no overlay e no conteúdo; select em `z-[90]`.
- [x] Clique no select portaled não fecha o Dialog.
- [x] Sheet não trata select/popover/dropdown como clique fora.
- [ ] Verificar no browser o fluxo no detalhe do produto (não só screenshot).

## Notas para a IA

Não inventar outro visual. Reutilizar o diálogo atual. Pares kg/g e l/ml continuam **Travada**.
