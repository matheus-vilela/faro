# Feature: Escolher unidade no WhatsApp

- **Slug:** `whatsapp-escolher-unidade`
- **Status:** feita
- **Área:** webhook `received-whatsapp-message` / WhatsApp

## Problema

O agente Faro é um único número. A empresa sai só do celular de quem manda a mensagem. Se o mesmo WhatsApp for dono ou operador ativo em duas unidades, o webhook recusa (`AMBIGUOUS_COMPANY`, HTTP 409) e **não responde**. Quem opera duas lojas do grupo não consegue usar o Faro.

## Objetivo

Com o número em mais de uma unidade, o Faro pergunta qual loja, guarda a escolha no turno e deixa trocar com *loja*.

## Fora de escopo

- Perguntar a loja a cada mensagem.
- Guardar foto/PDF para processar depois da escolha (a pessoa reenvia).
- Número de agente WhatsApp por unidade.
- Sessão compartilhada em grupo (mesmo seletor por remetente).
- Bloquear cadastro do mesmo número em duas unidades.

## Contexto no código

Arquivos e peças que a IA deve abrir primeiro:

- Páginas / rotas: `web/src/pages/ConfiguracoesWhatsapp.tsx`, `web/src/pages/ConfiguracoesUsuarios.tsx`
- Backend: `supabase/functions/received-whatsapp-message/index.ts` (`authorizeIncomingMessage`)
- Padrão de menu numérico: `whatsapp_recebimento_menu`, `whatsapp_checklist_menu`
- Regras Cursor relacionadas: —

## Comportamento esperado

- Um único match (dono ou operador ativo): fluxo atual, sem pergunta.
- Dois ou mais matches: se não houver unidade válida na sessão (12 h), envia menu `1) Nome…` e **não** processa o comando/mídia.
- Resposta só com o número escolhe a unidade e confirma. O comando ou a foto devem ser enviados de novo.
- Com unidade na sessão, *lista*, *estoque*, foto etc. usam essa empresa. Papel (dono/operador) é o da unidade escolhida.
- *loja* / *unidade* reabre o menu. Enquanto o menu de troca está aberto, um número escolhe a loja (não o menu de recebimento/checklist).
- Unidade some do cadastro ou a sessão expira: pergunta de novo.
- *comandos* inclui *loja* quando há mais de uma unidade.

## Critérios de aceite

- [x] Número em uma unidade: WhatsApp funciona como hoje, sem menu de loja.
- [x] Número em duas unidades, sem sessão: Faro pergunta a loja e não processa *lista*/foto nessa mensagem.
- [x] Responder `1` ou `2` grava a unidade; a mensagem seguinte usa essa loja.
- [x] *loja* ou *unidade* troca; número nessa hora não dispara recebimento/checklist.
- [x] Sessão de 12 h; depois pergunta de novo.
- [x] Unidade desativada/removida do número: pergunta de novo.
- [x] Textos de Configurações → WhatsApp e Usuários explicam o seletor.

## Notas para a IA

Reutilizar o menu numérico (1–20) e o rodapé `withFaroFlowFooter`. O seletor é por telefone, **sem** `company_id` na chave — senão não dá para perguntar. Não importar `index.ts` em testes (ele sobe `Deno.serve`).
