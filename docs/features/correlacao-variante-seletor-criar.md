# Feature: Variante — criar agrupamento no seletor

- **Slug:** `correlacao-variante-seletor-criar`
- **Status:** pronto
- **Área:** `/app/produtos` (Correlação · Para corrigir)

## Problema

Em «Faz parte de um agrupamento» há um campo à parte («Ou cadastre um agrupamento novo»). Os outros `SearchSelect` do app criam pelo próprio seletor: o usuário digita, não acha, e escolhe cadastrar o nome.

## Objetivo

Cadastrar agrupamento inédito só pelo seletor, sem campo extra abaixo.

## Fora de escopo

- Formulário completo do agrupamento (SKU, categorias).
- Abrir `CreateProductSheet`.
- Mudar como o cadastro mínimo é gravado ao ligar.

## Contexto no código

- `web/src/components/products/SaleFamilyDestinationFields.tsx`
- `web/src/components/ui/search-select.tsx` — `trailingOptions`
- `docs/features/correlacao-variante-criar-agrupamento.md`

## Comportamento esperado

- Busca um agrupamento (ou produto que vira agrupamento ao ligar).
- Nome digitado sem correspondência: opção «Cadastrar «nome» como agrupamento» no fim da lista.
- Sem campo «Ou cadastre um agrupamento novo».
- Nome igual a um cadastro existente seleciona esse cadastro.

## Critérios de aceite

- [x] O painel de variante não mostra campo de texto extra para nome novo.
- [x] Digitar um nome inédito no seletor oferece cadastrar esse nome.
- [x] Nome igual a um cadastro existente não oferece criar duplicata.
- [ ] Verificar no browser o fluxo principal (não só screenshot).

## Notas para a IA

Reutilizar o `trailingOptions` já existente. Não inventar outro input.
