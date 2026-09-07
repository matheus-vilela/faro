import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  COMPANY_PICKER_MAX,
  COMPANY_SESSION_TTL_MS,
  buildCompanyPickerMessage,
  buildCompanySelectedMessage,
  decideCompanyContext,
  isLojaCommand,
  parseCompanyPickerOption,
  sortCompanyMatches,
  type CompanyWhatsappMatch,
} from "./whatsappCompanyContext.ts";

const A: CompanyWhatsappMatch = {
  companyId: "aaa",
  companyName: "Shopping",
  role: "member",
  companyMemberId: "m1",
};
const B: CompanyWhatsappMatch = {
  companyId: "bbb",
  companyName: "Centro",
  role: "owner",
  companyMemberId: null,
};

Deno.test("isLojaCommand reconhece loja e unidade", () => {
  assertEquals(isLojaCommand("loja"), true);
  assertEquals(isLojaCommand("*Unidade*"), true);
  assertEquals(isLojaCommand("trocar loja"), true);
  assertEquals(isLojaCommand("lista"), false);
});

Deno.test("parseCompanyPickerOption só aceita 1–20", () => {
  assertEquals(parseCompanyPickerOption("1"), 1);
  assertEquals(parseCompanyPickerOption("20"), 20);
  assertEquals(parseCompanyPickerOption("21"), null);
  assertEquals(parseCompanyPickerOption("1)"), null);
});

Deno.test("sortCompanyMatches ordena por nome pt-BR", () => {
  const sorted = sortCompanyMatches([A, B]);
  assertEquals(sorted.map((m) => m.companyName), ["Centro", "Shopping"]);
});

Deno.test("uma unidade resolve sem pergunta", () => {
  const d = decideCompanyContext({
    matches: [A],
    context: null,
    text: "lista",
    nowMs: 1_000,
  });
  assertEquals(d, { action: "single", companyId: "aaa" });
});

Deno.test("uma unidade + loja só informa o nome", () => {
  const d = decideCompanyContext({
    matches: [B],
    context: null,
    text: "loja",
    nowMs: 1_000,
  });
  assertEquals(d, { action: "single_loja_info", companyId: "bbb" });
});

Deno.test("duas unidades sem sessão pedem escolha", () => {
  const d = decideCompanyContext({
    matches: [A, B],
    context: null,
    text: "lista",
    nowMs: 1_000,
  });
  assertEquals(d.action, "ask");
  if (d.action === "ask") assertEquals(d.reason, "no_selection");
});

Deno.test("número no menu pendente seleciona a unidade", () => {
  const sorted = sortCompanyMatches([A, B]);
  const d = decideCompanyContext({
    matches: [A, B],
    context: {
      selected_company_id: null,
      selected_at: null,
      pending_company_ids: sorted.map((m) => m.companyId),
      pending_at: new Date(5_000).toISOString(),
    },
    text: "1",
    nowMs: 6_000,
  });
  assertEquals(d, { action: "select", companyId: "bbb" });
});

Deno.test("opção fora do menu pendente é inválida", () => {
  const d = decideCompanyContext({
    matches: [A, B],
    context: {
      selected_company_id: null,
      selected_at: null,
      pending_company_ids: ["bbb", "aaa"],
      pending_at: new Date(5_000).toISOString(),
    },
    text: "9",
    nowMs: 6_000,
  });
  assertEquals(d.action, "invalid_option");
});

Deno.test("sessão válida usa a unidade escolhida", () => {
  const d = decideCompanyContext({
    matches: [A, B],
    context: {
      selected_company_id: "aaa",
      selected_at: new Date(1_000).toISOString(),
      pending_company_ids: [],
      pending_at: null,
    },
    text: "lista",
    nowMs: 1_000 + COMPANY_SESSION_TTL_MS / 2,
  });
  assertEquals(d, { action: "use", companyId: "aaa" });
});

Deno.test("sessão expirada pergunta de novo", () => {
  const d = decideCompanyContext({
    matches: [A, B],
    context: {
      selected_company_id: "aaa",
      selected_at: new Date(1_000).toISOString(),
      pending_company_ids: [],
      pending_at: null,
    },
    text: "lista",
    nowMs: 1_000 + COMPANY_SESSION_TTL_MS + 1,
  });
  assertEquals(d.action, "ask");
  if (d.action === "ask") assertEquals(d.reason, "expired");
});

Deno.test("duas unidades, seleção stale, pergunta", () => {
  const d = decideCompanyContext({
    matches: [A, B],
    context: {
      selected_company_id: "zzz",
      selected_at: new Date(1_000).toISOString(),
      pending_company_ids: [],
      pending_at: null,
    },
    text: "lista",
    nowMs: 2_000,
  });
  assertEquals(d.action, "ask");
  if (d.action === "ask") assertEquals(d.reason, "stale");
});

Deno.test("número sem menu de loja usa a sessão (não troca unidade)", () => {
  const d = decideCompanyContext({
    matches: [A, B],
    context: {
      selected_company_id: "aaa",
      selected_at: new Date(1_000).toISOString(),
      pending_company_ids: [],
      pending_at: null,
    },
    text: "1",
    nowMs: 2_000,
  });
  assertEquals(d, { action: "use", companyId: "aaa" });
});

Deno.test("loja com sessão reabre o menu", () => {
  const d = decideCompanyContext({
    matches: [A, B],
    context: {
      selected_company_id: "aaa",
      selected_at: new Date(1_000).toISOString(),
      pending_company_ids: [],
      pending_at: null,
    },
    text: "loja",
    nowMs: 2_000,
  });
  assertEquals(d, { action: "ask", reason: "switch" });
});

Deno.test("número escolhe loja enquanto o menu de troca está aberto", () => {
  const d = decideCompanyContext({
    matches: [A, B],
    context: {
      selected_company_id: "aaa",
      selected_at: new Date(1_000).toISOString(),
      pending_company_ids: ["bbb", "aaa"],
      pending_at: new Date(2_000).toISOString(),
    },
    text: "1",
    nowMs: 3_000,
  });
  assertEquals(d, { action: "select", companyId: "bbb" });
});

Deno.test("pending id que saiu do cadastro pede menu de novo", () => {
  const d = decideCompanyContext({
    matches: [A, B],
    context: {
      selected_company_id: null,
      selected_at: null,
      pending_company_ids: ["zzz", "aaa"],
      pending_at: new Date(2_000).toISOString(),
    },
    text: "1",
    nowMs: 3_000,
  });
  assertEquals(d, { action: "ask", reason: "stale" });
});

Deno.test("mensagem do seletor lista as lojas e pede reenvio", () => {
  const msg = buildCompanyPickerMessage([A, B], {
    hadCommand: true,
    currentName: "Shopping",
  });
  assertStringIncludes(msg, "1) Centro");
  assertStringIncludes(msg, "2) Shopping");
  assertStringIncludes(msg, "envie o comando de novo");
  assertStringIncludes(msg, "Unidade atual: *Shopping*");
  const selected = buildCompanySelectedMessage("Centro");
  assertStringIncludes(selected, "*Centro*");
  assertEquals(COMPANY_PICKER_MAX, 20);
});
