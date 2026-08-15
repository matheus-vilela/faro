/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck Deno imports
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

type DraftItem = {
  title: string;
  item_type: string;
  requires_evidence?: boolean;
  config?: Record<string, unknown>;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const userClient = createClient(supabaseUrl, anon, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  let prompt = "";
  try {
    const body = await req.json();
    prompt = String(body?.prompt ?? "").trim();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  if (!prompt) {
    return json({ ok: false, error: "empty_prompt" }, 400);
  }

  const apiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
  const system = [
    "Você é o Faro, assistente caloroso para gestores de bar/restaurante no Brasil.",
    "Monte um checklist operacional estruturado a partir do pedido do gestor.",
    "Retorne SOMENTE JSON no formato:",
    '{"title":"...","description":"...","items":[{"title":"...","item_type":"check|numeric|photo|note|rating|signature|barcode","requires_evidence":false,"config":{}}],"next_suggestion":"..."}',
    "Prefira 5–12 itens claros, com tipos ricos quando fizer sentido (temperatura=numeric, foto de limpeza=photo).",
    "next_suggestion: uma pergunta curta sugerindo o próximo passo (ex.: 'Quer incluir item de temperatura?').",
  ].join("\n");

  let title = "Checklist sugerido";
  let description = "";
  let items: DraftItem[] = [];
  let next_suggestion = "Quer ajustar recorrência ou responsáveis?";

  if (apiKey) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content === "string") {
        try {
          const parsed = JSON.parse(content) as {
            title?: string;
            description?: string;
            items?: DraftItem[];
            next_suggestion?: string;
          };
          if (parsed.title) title = parsed.title;
          if (parsed.description) description = parsed.description;
          if (Array.isArray(parsed.items)) {
            items = parsed.items
              .filter((i) => i && typeof i.title === "string" && i.title.trim())
              .map((i) => ({
                title: i.title.trim(),
                item_type: [
                  "check",
                  "numeric",
                  "photo",
                  "note",
                  "rating",
                  "signature",
                  "barcode",
                ].includes(String(i.item_type))
                  ? String(i.item_type)
                  : "check",
                requires_evidence: Boolean(i.requires_evidence),
                config: i.config && typeof i.config === "object" ? i.config : {},
              }));
          }
          if (parsed.next_suggestion) next_suggestion = parsed.next_suggestion;
        } catch {
          /* fallback below */
        }
      }
    }
  }

  if (items.length === 0) {
    title = prompt.length > 60 ? "Checklist operacional" : prompt;
    description = "Rascunho gerado sem IA (fallback). Revise os itens.";
    items = [
      { title: "Conferir área limpa", item_type: "check" },
      { title: "Registrar temperatura crítica", item_type: "numeric", config: { unit: "°C", critical: true } },
      { title: "Foto da estação", item_type: "photo", requires_evidence: true },
      { title: "Observações do turno", item_type: "note" },
      { title: "Ciência do responsável", item_type: "signature", requires_evidence: true },
    ];
    next_suggestion = "Quer que eu detalhe mais algum setor (bar, salão, cozinha)?";
  }

  return json({
    ok: true,
    title,
    description,
    items,
    next_suggestion,
    llm_provider: apiKey ? "openai" : "fallback",
  });
});
