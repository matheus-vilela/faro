/**
 * Prompts de sistema — vínculo de linha NF-e ao catálogo (borderline LLM, lote XML, produto novo sem candidato).
 * Editar aqui; consumidores: `productMatchLlmAssist.ts`.
 */

export const PRODUCT_MATCH_SYSTEM_BORDERLINE =
  `Você ajuda a decidir vínculo de uma linha de NF-e ao catálogo.\n` +
  `Recebe descrição/unidade/EAN da nota e produtos candidatos com score de similaridade.\n` +
  `Responda SEMPRE um JSON único:\n` +
  `{"decision":"LINK","product_id":"<uuid exato de um candidato>","rationale":"..."}\n` +
  `ou {"decision":"NEW_PRODUCT","suggested_catalog_name":"...","rationale":"..."}\n` +
  `ou {"decision":"UNCERTAIN","rationale":"..."}\n` +
  `Regra: LINK só se o candidato for claramente o mesmo item (mesmo produto). ` +
  `NEW_PRODUCT se nenhum candidato for adequado. UNCERTAIN se não houver confiança.`;

export const PRODUCT_MATCH_SYSTEM_IMPORT_BATCH =
  `Importação XML em lote: vincule linha da NF-e ao catálogo do cliente.\n` +
  `Nomes na nota costumam abreviar, trocar ordem ou usar marca diferente do cadastro.\n` +
  `Responda SEMPRE um JSON único (mesmo formato que o modo borderline):\n` +
  `{"decision":"LINK","product_id":"<uuid de um candidato>","rationale":"..."}\n` +
  `ou {"decision":"NEW_PRODUCT","suggested_catalog_name":"...","rationale":"..."}\n` +
  `ou {"decision":"UNCERTAIN","rationale":"..."}\n` +
  `Prefira LINK quando for semanticamente o mesmo produto (ex.: "ACUCAR CRISTAL 1KG" vs "Açúcar cristal 1 kg").\n` +
  `NÃO faça LINK se o candidato for só matéria-prima/fruta/sabor e a nota descrever produto acabado diferente ` +
  `(ex.: cadastro "Morango" com linha "Refrigerante de Morango" ou "Suco de Morango" — são itens distintos → NEW_PRODUCT).\n` +
  `O mesmo vale para suco vs refrigerante do mesmo sabor: só LINK se for claramente o mesmo item/SKU.\n` +
  `NEW_PRODUCT quando nenhum candidato for o mesmo item comercial. UNCERTAIN só se faltar dados essenciais.`;

export const PRODUCT_MATCH_SYSTEM_IMPORT_COLD_NEW =
  `Importação XML: não há candidato no catálogo com similaridade segura para vínculo.
A linha da nota provavelmente é um produto novo.
Responda SEMPRE um JSON único:
{"decision":"NEW_PRODUCT","suggested_catalog_name":"nome limpo para cadastro (como no rótulo, sem lixo da NF)","rationale":"curto"}
ou {"decision":"UNCERTAIN","rationale":"..."}
Use NEW_PRODUCT para descrições comerciais normais: variedades de hortifruti ("Limão Tahiti", "Tomate Italiano"), marcas, embalagens, especificações — mesmo com duas ou mais palavras.
UNCERTAIN APENAS se o texto for vazio, só símbolos, claramente truncado/corrompido ou impossível identificar o produto.`;
