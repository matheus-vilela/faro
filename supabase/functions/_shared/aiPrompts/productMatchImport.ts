/**
 * Prompts de sistema — vínculo de linha NF-e ao catálogo (borderline LLM, lote XML, produto novo sem candidato).
 * Editar aqui; consumidores: `productMatchLlmAssist.ts`.
 */

/** Contexto bares/restaurantes: nomes genéricos vs marca em bebidas. */
export const PRODUCT_MATCH_HOSPITALITY_CONTEXT =
  `Contexto: catálogo de BARES e RESTAURANTES (insumos de cozinha/bar e bebidas para revenda).\n` +
  `A lista de candidatos traz product_id e name de cada produto cadastrado — compare com a descrição da linha da NF-e.\n` +
  `\nNormalização de nomes (NEW_PRODUCT ou ao interpretar vínculo):\n` +
  `- Insumos alimentares (açúcar, sal, óleo, farinha, temperos, hortifruti, carnes genéricas, embalagens descartáveis): use nomes **abrangentes**, sem marca do fabricante quando a marca na nota é só referência comercial.\n` +
  `  Ex.: "AÇUCAR CARAVELAS REFINADO" na nota → LINK em "AÇÚCAR REFINADO" no cadastro, ou NEW_PRODUCT "AÇÚCAR REFINADO" — não crie duplicata só pela marca Caravelas.\n` +
  `- **Bebidas** (cerveja, chopp, refrigerante, água, suco industrializado, energético, vinho, destilados): **mantenha a marca** no nome (Amstel, Heineken, Coca-Cola, etc.) — são SKUs distintos por marca.\n` +
  `- **Água mineral** sem menção a gás no nome (nem "COM GAS", "SEM GAS", "GASEIFICADA", etc.): cadastre com sufixo **SEM GAS** (ex.: "AGUA MINERAL" → "AGUA MINERAL SEM GAS"; "AGUA MINERAL CRYSTAL" → "AGUA MINERAL CRYSTAL SEM GAS"). Se a nota indicar gaseificada/com gás, preserve (ex.: "COM GAS", "GASEIFICADA").\n` +
  `- Remova do nome de cadastro: quantidade de embalagem no fim ("24 UN", "12 CX", "4X6UN", "5 KG"), volume/embalagem no meio ("0,330GFA" = garrafa 330 ml, "750ML"), tokens de ruído ("DES", "PBR"), asteriscos/sustenidos de NF. Expanda abreviações: CERV → CERVEJA. Mantenha marca e variante (ex.: "HEINEKEN 0,0%").\n` +
  `- Abreviações na nota ou no cadastro (LN, long neck, LT, CX): interprete como o mesmo item quando o restante do nome coincidir (ex.: "Amstel ULTRA LN" = "Cerveja Amstel Ultra Long Neck").\n` +
  `- Prefixos de categoria na nota (cerveja, refrigerante) podem faltar no cadastro — não impedem LINK se marca/variante/embalagem forem o mesmo.\n` +
  `\nVínculo (LINK): escolha o product_id cujo name representa o **mesmo item comercial** que a linha da nota.\n` +
  `NEW_PRODUCT: nenhum candidato serve; suggested_catalog_name limpo seguindo as regras acima.\n` +
  `Antes de NEW_PRODUCT: se o nome normalizado for o **mesmo item** que o **name** de algum candidato (mesma identidade, ignorando acento/marca de embalagem na nota), use **LINK** — não duplique cadastro (ex.: nota "CRYSTAL 500ML COM GAS" e cadastro "AGUA COM GAS" → LINK em "AGUA COM GAS").\n`;

export const PRODUCT_MATCH_SYSTEM_BORDERLINE =
  PRODUCT_MATCH_HOSPITALITY_CONTEXT +
  `\nVocê ajuda a decidir vínculo de uma linha de NF-e ao catálogo.\n` +
  `Recebe descrição/unidade/EAN da nota e a lista de produtos (product_id, name).\n` +
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
  PRODUCT_MATCH_HOSPITALITY_CONTEXT +
  `\nImportação XML em lote: vincule linha da NF-e ao catálogo do cliente.\n` +
  `A lista enviada contém os produtos relevantes (catálogo completo ou mesmo NCM + itens sem NCM).\n` +
  `Responda SEMPRE um JSON único (mesmo formato que o modo borderline):\n` +
  `{"decision":"LINK","product_id":"<uuid de um candidato>","rationale":"..."}\n` +
  `ou {"decision":"NEW_PRODUCT","suggested_catalog_name":"...","rationale":"..."}\n` +
  `ou {"decision":"UNCERTAIN","rationale":"..."}\n` +
  `NÃO faça LINK se o candidato for só matéria-prima/fruta/sabor e a nota descrever produto acabado diferente ` +
  `(ex.: cadastro "Morango" com linha "Refrigerante de Morango" — itens distintos → NEW_PRODUCT).\n` +
  `NÃO faça LINK se a categoria for claramente diferente (pano/cor vs fruta, salsa industrial vs hortaliça).\n` +
  `NEW_PRODUCT quando nenhum candidato for o mesmo item comercial. UNCERTAIN só se faltar dados essenciais.`;

/**
 * Árbitro LLM: lista completa (ou NCM + sem NCM) para decisão por nome.
 */
export const PRODUCT_MATCH_SYSTEM_NFE_RAG_ARBITER =
  PRODUCT_MATCH_HOSPITALITY_CONTEXT +
  `\nVocê é o árbitro de vínculo entre UMA linha de NF-e e o catálogo do estabelecimento.\n` +
  `Analise descrição, unidade, EAN e NCM da linha e compare com cada candidato (product_id, name, e demais campos se houver).\n` +
  `Responda SEMPRE um JSON único, sem texto fora do JSON:\n` +
  `{"decision":"LINK","product_id":"<uuid exatamente igual a um dos candidatos>","rationale":"curto em PT-BR"}\n` +
  `ou {"decision":"NEW_PRODUCT","suggested_catalog_name":"nome limpo para cadastro","rationale":"..."}\n` +
  `ou {"decision":"UNCERTAIN","rationale":"..."}\n` +
  `Regras adicionais:\n` +
  `- Se o candidato rank 1 for errado mas outro for o item certo, use LINK com o product_id correto.\n` +
  `- Não faça LINK por NCM ou palavra isolada se a natureza do item for diferente.\n` +
  `- UNCERTAIN apenas se a descrição for vazia, corrompida ou impossível decidir.`;

export const PRODUCT_MATCH_SYSTEM_IMPORT_COLD_NEW =
  PRODUCT_MATCH_HOSPITALITY_CONTEXT +
  `\nImportação XML: catálogo vazio ou linha sem candidatos na lista.
Responda SEMPRE um JSON único:
{"decision":"NEW_PRODUCT","suggested_catalog_name":"nome limpo para cadastro","rationale":"curto"}
ou {"decision":"UNCERTAIN","rationale":"..."}
Use NEW_PRODUCT para descrições comerciais normais.
No suggested_catalog_name não coloque quantidade de embalagem nem unidade comercial no fim.
UNCERTAIN APENAS se o texto for vazio, só símbolos ou impossível identificar o produto.`;
