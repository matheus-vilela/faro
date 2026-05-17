/**
 * LLM para interpretação staging NF-e: vínculo por NCM + nome normalizado e
 * quantidade/valor unitário corretos para entrada em estoque (pack no texto da linha).
 */
import { PRODUCT_MATCH_SYSTEM_NFE_RAG_ARBITER } from "./aiPrompts/productMatchImport.ts";
import type { NfeRagArbiterCandidate } from "./productImport/productMatchLlmAssist.ts";
import { sanitizeCatalogProductName } from "./productImport/canonicalName.ts";
import type { StagingNfeInterpretLog } from "./stagingNfeInterpretLog.ts";

const STAGING_NFE_LINE_STOCK_SYSTEM =
  PRODUCT_MATCH_SYSTEM_NFE_RAG_ARBITER +
  `\n\n--- Contexto staging (candidatos = mesmo NCM 8 dígitos no cadastro da empresa) ---\n` +
  `- A nota pode truncar ou abreviar; ainda pode ser o mesmo item do cadastro.\n` +
  `- Cadastro **sem marca** no nome vs nota **com marca** (ex.: nota "LINGUIÇA TOSCANA SADIA", cadastro "Linguica toscana") → pode LINK.\n` +
  `- Cadastro **abreviado** vs nota **por extenso** (ex.: cadastro "Amstel ULTRA LN", nota "Cerveja Amstel Ultra Long Neck") → LINK se for o mesmo item (LN = long neck).\n` +
  `- Na lista há produtos **sem NCM no cadastro** (marcados na lista): avalie pelo nome comercial; podem ser o item certo mesmo com NCM só na nota.\n` +
  `- Cadastro **com marca A** e nota **marca B** distinta (ex.: Sadia vs Seara) → não LINK.\n` +
  `- Marcas concorrentes (Coca vs Pepsi, etc.) → não LINK.\n` +
  `\n--- Nome normalizado e estoque (obrigatório ler com atenção) ---\n` +
  `Muitas NF-e trazem no **nome do item** a contagem da embalagem (ex.: "HEINEKEN LONG NECK 24UN", "CERVEJA 12X350ML", "REFRIGERANTE CX 6", "FARDO AGUA 12UN") enquanto **qCom** na linha é 1 (uma embalada) e o **valor total da linha** já é o da compra inteira.\n` +
  `Para **entrada em estoque** o sistema precisa da **quantidade de unidades de consumo** (ex.: 24 garrafas) e do **valor unitário de cada uma** (valor total da linha ÷ essa quantidade).\n` +
  `Exemplo: descrição "heineken longneck 24UN", quantidade XML = 1, valor total linha = 24 → stock_quantity = 24, stock_unit_value = 1 (não use quantidade XML 1 como 1 garrafa).\n` +
  `Outro: se for realmente 1 caixa com 12 unidades e o nome indica 12, use 12 e valor_total/12.\n` +
  `\n**normalized_product_name** (obrigatório em NEW_PRODUCT; opcional em LINK se quiser refletir limpeza):\n` +
  `- Nome comercial do **produto** sem contagem de embalagem no texto: **não** incluir sufixos como "24UN", "10X1KG", "12X350ML", "6X950ML", "1,002 KG PCT", "CX6", "FD12", "PCT 10", "PC 1KG", quantidades coladas ao final.\n` +
  `- **Nunca** começar o nome com asterisco (*), sustenido (#) ou outros prefixos de impressão de NF; remova-os por completo.\n` +
  `- Remova siglas que são só **embalagem/medida de lote** (UN, CX, FD, PCT, PÇ, KG no contexto de fardo, etc.) quando não fazem parte do nome da marca/produto.\n` +
  `- Mantenha **marca** e **tipo** do item (ex.: "Heineken Long Neck", "Linguiça Toscana Sadia").\n` +
  `\n**suggested_catalog_name** (NEW_PRODUCT): deve ser **o mesmo nome limpo** que normalized_product_name (ou abreviação mínima sem perder a identidade do item); **não** repita o texto bruto da nota com pesos, packs ou medidas.\n` +
  `\n**stock_quantity** e **stock_unit_value** (números > 0, use ponto decimal):\n` +
  `- Em NEW_PRODUCT: **obrigatórios** — quantidade física de unidades do produto normalizado e preço unitário coerente com valor total da linha (stock_quantity × stock_unit_value ≈ valor total da linha; tolerância centavos).\n` +
  `- Em LINK: **opcionais** — preencha se a linha XML esconder pack no nome e precisar corrigir quantidade/valor para estoque; se não precisar correção, use quantidade e valor unitário da linha XML (repita nos campos ou omita e o sistema usa XML).\n` +
  `- Marque **uses_packaging_from_description** = true quando a contagem efetiva veio principalmente do texto do nome e não só do XML.\n` +
  `\nResponda **apenas** um JSON válido (sem markdown), com esta forma:\n` +
  `{"decision":"LINK"|"NEW_PRODUCT"|"UNCERTAIN","product_id":null ou uuid,"rationale":"...","normalized_product_name":null ou string,"suggested_catalog_name":null ou string,"stock_quantity":number,"stock_unit_value":number,"uses_packaging_from_description":boolean}\n` +
  `- LINK: product_id obrigatório (uuid de um candidato). normalized_product_name pode ser null. stock_* opcionais (se omitidos, assume-se XML).\n` +
  `- NEW_PRODUCT: product_id null. normalized_product_name e suggested_catalog_name obrigatórios (strings não vazias). stock_quantity e stock_unit_value obrigatórios.\n` +
  `- UNCERTAIN: demais campos podem ser null/default; explique em rationale.\n`;

export type StagingNfeLineStockMatchInput = {
  line: StagingNfeInterpretLog["produtos"][number];
  candidates: NfeRagArbiterCandidate[];
};

export type StagingNfeLineStockMatchResult =
  | {
      kind: "LINK";
      product_id: string;
      rationale: string;
      normalized_product_name: string | null;
      stock_quantity: number;
      stock_unit_value: number;
      uses_packaging_from_description: boolean;
      stock_recalibrated_from_xml: boolean;
    }
  | {
      kind: "NEW_PRODUCT";
      suggested_catalog_name: string;
      normalized_product_name: string;
      rationale: string;
      stock_quantity: number;
      stock_unit_value: number;
      uses_packaging_from_description: boolean;
      stock_recalibrated_from_xml: boolean;
    }
  | { kind: "SKIP"; rationale: string }
  | { kind: "ERROR"; message: string };

function parsePositiveNum(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  const n = typeof v === "number" ? v : Number(String(v).trim().replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function strOrNull(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/** Se qty×unit não bate com o total da linha, recalcula a partir do XML. */
export function reconcileStockWithLineTotal(
  line: StagingNfeInterpretLog["produtos"][number],
  stockQty: number | null,
  stockUnit: number | null,
): {
  quantity: number;
  unit_value: number;
  recalibrated: boolean;
} {
  const total = Number(line.valor_total_linha);
  const xmlQty = Number(line.quantidade);
  const xmlUnit = Number(line.valor_unitario);

  const qIn = stockQty != null && Number.isFinite(stockQty) && stockQty > 0 ? stockQty : null;
  const uIn = stockUnit != null && Number.isFinite(stockUnit) && stockUnit > 0 ? stockUnit : null;

  if (qIn != null && uIn != null && Number.isFinite(total)) {
    const implied = qIn * uIn;
    const tol = Math.max(0.02, 0.02 * Math.abs(total));
    if (Math.abs(implied - total) <= tol) {
      return { quantity: qIn, unit_value: uIn, recalibrated: false };
    }
  }

  const q0 = xmlQty > 0 ? xmlQty : 1;
  const u0 =
    Number.isFinite(total) && q0 > 0
      ? total / q0
      : Number.isFinite(xmlUnit) && xmlUnit > 0
        ? xmlUnit
        : 0;
  return { quantity: q0, unit_value: u0 > 0 ? u0 : 0, recalibrated: true };
}

export async function assistStagingNfeLineStockNormalizeAndMatch(
  apiKey: string,
  model: string,
  input: StagingNfeLineStockMatchInput,
): Promise<StagingNfeLineStockMatchResult> {
  if (!apiKey.trim()) {
    return { kind: "ERROR", message: "OPENAI_API_KEY ausente." };
  }
  const { line, candidates } = input;
  if (!candidates.length) {
    return { kind: "SKIP", rationale: "Sem candidatos." };
  }

  const allowed = new Set(candidates.map((c) => c.product_id));

  const userPayload = {
    invoice_line: {
      description: line.nome,
      qty_xml: line.quantidade,
      unit_value_xml: line.valor_unitario,
      line_total: line.valor_total_linha,
      unit_commercial: line.unidade_comercial,
      ncm: line.ncm,
      ean: line.ean,
      codigo: line.codigo,
    },
    candidates: candidates.map((c) => ({
      rank: c.rank,
      product_id: c.product_id,
      name: c.name,
      unit: c.catalog_unit,
      ncm: c.ncm,
      barcode_digits: c.barcode_digits,
      score_0_100: c.similarity_0_100,
      detail: c.match_detail,
    })),
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.05,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: STAGING_NFE_LINE_STOCK_SYSTEM },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    return { kind: "ERROR", message: `OpenAI ${res.status}: ${txt.slice(0, 200)}` };
  }

  const data = await res.json();
  const txt = String(data?.choices?.[0]?.message?.content ?? "").trim();
  try {
    const parsed = JSON.parse(txt) as Record<string, unknown>;
    const decision = String(parsed.decision ?? "").toUpperCase();
    const rationale = String(parsed.rationale ?? "").trim() || "—";
    const usesPack = parsed.uses_packaging_from_description === true;

    const rawNorm = strOrNull(parsed.normalized_product_name);
    const normalizedProductName = rawNorm ? sanitizeCatalogProductName(rawNorm) : null;

    const sq = parsePositiveNum(parsed.stock_quantity);
    const su = parsePositiveNum(parsed.stock_unit_value);
    const rec = reconcileStockWithLineTotal(line, sq, su);

    if (decision === "LINK") {
      const pid = String(parsed.product_id ?? "").trim();
      if (!pid || !allowed.has(pid)) {
        return {
          kind: "SKIP",
          rationale: `LINK inválido ou fora dos candidatos: ${rationale}`,
        };
      }
      const usesFromDesc =
        usesPack ||
        (sq != null &&
          su != null &&
          !rec.recalibrated &&
          Math.abs(Number(line.quantidade) - rec.quantity) > 1e-6);
      return {
        kind: "LINK",
        product_id: pid,
        rationale,
        normalized_product_name: normalizedProductName,
        stock_quantity: rec.quantity,
        stock_unit_value: rec.unit_value,
        uses_packaging_from_description: usesFromDesc,
        stock_recalibrated_from_xml: rec.recalibrated,
      };
    }

    if (decision === "NEW_PRODUCT") {
      const suggRaw = strOrNull(parsed.suggested_catalog_name);
      const suggestedStripped = suggRaw ? sanitizeCatalogProductName(suggRaw) : "";

      const normFinal =
        (normalizedProductName && normalizedProductName.length > 0
          ? normalizedProductName
          : suggestedStripped) || "";

      const suggested =
        (suggestedStripped.length > 0 ? suggestedStripped : normFinal) || normFinal;

      if (!suggested || !normFinal) {
        return { kind: "SKIP", rationale: `NEW_PRODUCT sem nome válido: ${rationale}` };
      }

      if (rec.unit_value <= 0) {
        return { kind: "SKIP", rationale: `NEW_PRODUCT sem valor unitário coerente: ${rationale}` };
      }

      const usesFromDescNew =
        usesPack ||
        (sq != null &&
          su != null &&
          !rec.recalibrated &&
          Math.abs(Number(line.quantidade) - rec.quantity) > 1e-6);

      return {
        kind: "NEW_PRODUCT",
        suggested_catalog_name: suggested.slice(0, 512),
        normalized_product_name: normFinal.slice(0, 512),
        rationale,
        stock_quantity: rec.quantity,
        stock_unit_value: rec.unit_value,
        uses_packaging_from_description: usesFromDescNew,
        stock_recalibrated_from_xml: rec.recalibrated,
      };
    }

    return { kind: "SKIP", rationale };
  } catch {
    return { kind: "ERROR", message: "JSON inválido do modelo (staging NF-e estoque)." };
  }
}
