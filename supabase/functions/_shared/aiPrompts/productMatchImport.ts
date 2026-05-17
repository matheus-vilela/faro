/**
 * Prompts de sistema — vínculo de linha NF-e ao catálogo (borderline LLM, lote XML, produto novo sem candidato).
 * Editar aqui; consumidores: `productMatchLlmAssist.ts`.
 */

export const PRODUCT_MATCH_SYSTEM_BORDERLINE =
  `Você ajuda a decidir vínculo de uma linha de NF-e ao catálogo.\n` +
  `Recebe descrição/unidade/EAN da nota e produtos candidatos com pontuação de similaridade (0–100).\n` +
  `Responda SEMPRE um JSON único:\n` +
  `{"decision":"LINK","product_id":"<uuid exato de um candidato>","rationale":"..."}\n` +
  `ou {"decision":"NEW_PRODUCT","suggested_catalog_name":"...","rationale":"..."}\n` +
  `ou {"decision":"UNCERTAIN","rationale":"..."}\n` +
  `Regra: LINK só se o candidato for claramente o mesmo item (mesmo produto). ` +
  `Não faça LINK por NCM ou palavra isolada se o tipo de produto for diferente (molho vs erva, pano/cor vs fruta, etc.). ` +
  `Em NEW_PRODUCT, o campo suggested_catalog_name é nome de cadastro: sem quantidade de embalagem no fim (ex.: "100 UN", "12 CX") ` +
  `nem unidade de medida isolada no fim (ex.: "5 KG", "500 ML"); pode manter especificação do item (ex.: "6mm", "1 litro" como tipo). ` +
  `NEW_PRODUCT se nenhum candidato for adequado. UNCERTAIN se não houver confiança.`;

export const PRODUCT_MATCH_SYSTEM_IMPORT_BATCH =
  `Importação XML em lote: vincule linha da NF-e ao catálogo do cliente.\n` +
  `Nomes na nota costumam abreviar, trocar ordem ou usar marca diferente do cadastro.\n` +
  `Responda SEMPRE um JSON único (mesmo formato que o modo borderline):\n` +
  `{"decision":"LINK","product_id":"<uuid de um candidato>","rationale":"..."}\n` +
  `ou {"decision":"NEW_PRODUCT","suggested_catalog_name":"...","rationale":"..."}\n` +
  `ou {"decision":"UNCERTAIN","rationale":"..."}\n` +
  `Prefira LINK quando for semanticamente o mesmo produto (ex.: "ACUCAR CRISTAL 1KG" vs "Açúcar cristal 1 kg").\n` +
  `Cadastro abreviado ou incompleto vs descrição longa na nota: interprete marca, linha e embalagem — ex.: nota "Cerveja Amstel Ultra Long Neck" e cadastro "Amstel ULTRA LN" → LINK (LN = long neck; "cerveja" é categoria na nota, não outro SKU).\n` +
  `Itens marcados na lista como cadastro sem NCM devem ser avaliados principalmente pelo nome, não ignorados por falta de NCM no cadastro.\n` +
  `NÃO faça LINK se o candidato for só matéria-prima/fruta/sabor e a nota descrever produto acabado diferente ` +
  `(ex.: cadastro "Morango" com linha "Refrigerante de Morango" ou "Suco de Morango" — são itens distintos → NEW_PRODUCT).\n` +
  `O mesmo vale para suco vs refrigerante do mesmo sabor: só LINK se for claramente o mesmo item/SKU.\n` +
  `NÃO faça LINK se a categoria do item for claramente diferente (ex.: linha "SALSA INDUSTRIAL" vs cadastro de erva/hortaliça; ` +
  `"PANO BOBINA ... LARANJA" cor da embalagem vs cadastro que é só fruta "laranja"). ` +
  `O score numérico pode subir por NCM genérico ou coincidência parcial de texto; ignore isso se o produto não for o mesmo item comercial.\n` +
  `Em NEW_PRODUCT, suggested_catalog_name sem sufixo de quantidade/unidade comercial no fim (ex.: "100 unidades", "5 kg"); mantenha marca e especificações úteis (ex.: "6mm").\n` +
  `NEW_PRODUCT quando nenhum candidato for o mesmo item comercial. UNCERTAIN só se faltar dados essenciais.`;

/**
 * Árbitro RAG + LLM: a lista já foi enriquecida com vizinhos semânticos (embedding do nome na nota).
 * O modelo deve escolher no máximo um produto do catálogo que seja o mesmo item comercial da linha.
 */
export const PRODUCT_MATCH_SYSTEM_NFE_RAG_ARBITER =
  `Você é o árbitro final de vínculo entre UMA linha de NF-e e o catálogo do estabelecimento.\n` +
  `A lista de candidatos já inclui busca semântica (RAG por embedding) e pontuações automáticas; ` +
  `essas pontuações podem estar erradas (ex.: substring genérica, NCM igual para produtos diferentes).\n` +
  `Analise descrição da nota, unidade, EAN e NCM da linha e compare com nome, unidade, NCM e código de barras de cada candidato.\n` +
  `Responda SEMPRE um JSON único, sem texto fora do JSON:\n` +
  `{"decision":"LINK","product_id":"<uuid exatamente igual a um dos candidatos>","rationale":"curto em PT-BR"}\n` +
  `ou {"decision":"NEW_PRODUCT","suggested_catalog_name":"nome limpo para cadastro","rationale":"..."}\n` +
  `ou {"decision":"UNCERTAIN","rationale":"..."}\n` +
  `Regras:\n` +
  `- LINK só se for claramente o mesmo produto comercial (mesmo SKU / mesmo item que o cliente compra sempre com aquele nome ou sinónimo óbvio).\n` +
  `- Nomes na nota costumam ser mais longos; cadastro pode estar abreviado (siglas de embalagem: LN, LT, CX) ou sem prefixo de categoria (cerveja, refrigerante). Compare o núcleo marca+variante+embalagem.\n` +
  `- Candidatos com "cadastro sem NCM" na lista existem só com nome/unidade: use o nome da nota para decidir LINK, não exija NCM igual no cadastro.\n` +
  `- Se o candidato rank 1 for errado mas outro rank for o item certo, use LINK com o product_id desse outro rank.\n` +
  `- Não faça LINK por NCM ou palavra isolada se a natureza do item for diferente (ex.: hortaliça vs pano de cor, matéria-prima vs produto acabado, suco vs refrigerante).\n` +
  `- NEW_PRODUCT quando nenhum candidato for o mesmo item. suggested_catalog_name: sem quantidade de embalagem nem "100 UN"/"12 CX"/"5 KG" no fim; mantenha marca e especificações úteis.\n` +
  `- UNCERTAIN apenas se a descrição da nota for vazia, corrompida ou impossível decidir com segurança.`;

export const PRODUCT_MATCH_SYSTEM_IMPORT_COLD_NEW =
  `Importação XML: não há candidato no catálogo com similaridade segura para vínculo.
A linha da nota provavelmente é um produto novo.
Responda SEMPRE um JSON único:
{"decision":"NEW_PRODUCT","suggested_catalog_name":"nome limpo para cadastro (como no rótulo, sem lixo da NF)","rationale":"curto"}
ou {"decision":"UNCERTAIN","rationale":"..."}
Use NEW_PRODUCT para descrições comerciais normais: variedades de hortifruti ("Limão Tahiti", "Tomate Italiano"), marcas, embalagens, especificações — mesmo com duas ou mais palavras.
No suggested_catalog_name não coloque quantidade de embalagem nem unidade comercial no fim (ex.: "100 UNIDADES", "12 CX", "5 KG"); pode manter dimensão/marca do produto (ex.: "6mm Golden").
UNCERTAIN APENAS se o texto for vazio, só símbolos, claramente truncado/corrompido ou impossível identificar o produto.`;
