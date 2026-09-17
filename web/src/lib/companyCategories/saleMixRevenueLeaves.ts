/**
 * Folhas DRE de receita que não são mix de produto (pagamento / dump).
 * Espelha supabase/functions/_shared/epocCsvRevenueClassification.ts — não usar
 * default_dre_category_id do catálogo aqui.
 */

function foldGrupoToken(s: string): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^[\d]+(?:[.][\d]+)*\s*[-–:]\s*/, "")
    .replace(/[.,;]+$/g, "")
    .replace(/[/_.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const PAYMENT_LEAF_NAME_RE =
  /^(dinheiro|pix|especie|cash|cartao|credito|debito|voucher|vr|alelo|sodexo|ticket|vale)$/;
const PAYMENT_LEAF_PHRASE_RE =
  /^(venda\s+)?pix(\s+epoc)?$|vr\s*\/?\s*alelo|vale\s+refeicao|cartao\s+de\s+(credito|debito)/;
const DUMP_LEAF_NAME_RE =
  /adiantamento|reservas?\s+e\s+eventos|^reservas$|outras\s+entradas/;

export function isPaymentMethodCategoryName(name: string): boolean {
  const n = foldGrupoToken(name);
  if (!n) return true;
  if (PAYMENT_LEAF_NAME_RE.test(n) || PAYMENT_LEAF_PHRASE_RE.test(n)) return true;
  if (n.length <= 22 && /\b(dinheiro|especie|cash)\b/.test(n)) return true;
  return false;
}

export function isExcludedSaleMixLeafName(name: string): boolean {
  const n = foldGrupoToken(name);
  if (!n) return true;
  if (isPaymentMethodCategoryName(name)) return true;
  if (DUMP_LEAF_NAME_RE.test(n)) return true;
  return false;
}
