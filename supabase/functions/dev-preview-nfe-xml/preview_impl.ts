/**
 * Handler leve: parse determinístico do XML + composição do valor unitário.
 */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck Deno imports
import { buildDevNfeXmlPreview } from "../_shared/devNfeXmlPreview.ts";
import { corsHeaders } from "./cors.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

export async function handleDevPreview(input: {
  fileName: string;
  xmlText: string;
}): Promise<Response> {
  const result = buildDevNfeXmlPreview(input.xmlText, input.fileName);
  if (!result.ok) return json(result, 422);
  return json(result);
}
