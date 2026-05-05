/**
 * Assistente LLM opcional para vínculo na faixa borderline (confirm ≤ score < auto).
 * Deno Edge + Vitest compatível via fetch JSON.
 */

import {
  PRODUCT_MATCH_SYSTEM_BORDERLINE,
  PRODUCT_MATCH_SYSTEM_IMPORT_BATCH,
  PRODUCT_MATCH_SYSTEM_IMPORT_COLD_NEW,
} from "../aiPrompts/productMatchImport.ts";

export type BorderlineCandidate = {
  product_id: string;
  product_name: string;
  catalog_unit: string | null;
  similarity_score_0_100: number;
};

export type BorderlineAssistInput = {
  invoice_description: string;
  invoice_unit_raw: string | null;
  invoice_ean: string | null;
  candidates: BorderlineCandidate[];
  /** `import_xml_batch`: nomes na nota podem divergir do cadastro; favoreça LINK semântico. */
  mode?: "borderline" | "import_xml_batch";
};

export type BorderlineAssistResult =
  | {
      kind: "LINK";
      product_id: string;
      rationale: string;
    }
  | {
      kind: "NEW_PRODUCT";
      suggested_catalog_name: string;
      rationale: string;
    }
  | {
      kind: "SKIP";
      rationale: string;
    }
  | {
      kind: "ERROR";
      message: string;
    };

export type ColdNewProductInput = {
  invoice_description: string;
  invoice_unit_raw: string | null;
  invoice_ean: string | null;
};

/** Sem candidatos no catálogo: só valida nome para cadastro automático (import XML em lote). */
export async function assistImportColdNewProduct(
  apiKey: string,
  model: string,
  input: ColdNewProductInput,
): Promise<BorderlineAssistResult> {
  if (!apiKey.trim()) {
    return { kind: "ERROR", message: "OPENAI_API_KEY ausente." };
  }
  const userPayload = {
    invoice: {
      description: input.invoice_description,
      unit: input.invoice_unit_raw,
      ean: input.invoice_ean,
    },
    candidates: [],
  };
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: PRODUCT_MATCH_SYSTEM_IMPORT_COLD_NEW },
        {
          role: "user",
          content: JSON.stringify(userPayload),
        },
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
    if (decision === "NEW_PRODUCT") {
      const name = String(parsed.suggested_catalog_name ?? "").trim();
      if (!name) {
        return { kind: "SKIP", rationale };
      }
      return {
        kind: "NEW_PRODUCT",
        suggested_catalog_name: name.slice(0, 512),
        rationale,
      };
    }
    return { kind: "SKIP", rationale };
  } catch {
    return { kind: "ERROR", message: "JSON inválido do modelo." };
  }
}

export async function assistBorderlineProductMatch(
  apiKey: string,
  model: string,
  input: BorderlineAssistInput,
): Promise<BorderlineAssistResult> {
  if (!apiKey.trim()) {
    return { kind: "ERROR", message: "OPENAI_API_KEY ausente." };
  }
  if (!input.candidates.length) {
    return { kind: "SKIP", rationale: "Sem candidatos." };
  }

  const userPayload = {
    invoice: {
      description: input.invoice_description,
      unit: input.invoice_unit_raw,
      ean: input.invoice_ean,
    },
    candidates: input.candidates.map((c) => ({
      product_id: c.product_id,
      name: c.product_name,
      unit: c.catalog_unit,
      score: c.similarity_score_0_100,
    })),
  };

  const system =
    input.mode === "import_xml_batch"
      ? PRODUCT_MATCH_SYSTEM_IMPORT_BATCH
      : PRODUCT_MATCH_SYSTEM_BORDERLINE;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: JSON.stringify(userPayload),
        },
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

    if (decision === "LINK") {
      const pid = String(parsed.product_id ?? "").trim();
      const allowed = new Set(input.candidates.map((c) => c.product_id));
      if (!pid || !allowed.has(pid)) {
        return { kind: "SKIP", rationale: `LINK inválido ou fora dos candidatos: ${rationale}` };
      }
      return { kind: "LINK", product_id: pid, rationale };
    }
    if (decision === "NEW_PRODUCT") {
      const name = String(parsed.suggested_catalog_name ?? "").trim();
      if (!name) {
        return { kind: "SKIP", rationale };
      }
      return {
        kind: "NEW_PRODUCT",
        suggested_catalog_name: name.slice(0, 512),
        rationale,
      };
    }
    return { kind: "SKIP", rationale };
  } catch {
    return { kind: "ERROR", message: "JSON inválido do modelo." };
  }
}
