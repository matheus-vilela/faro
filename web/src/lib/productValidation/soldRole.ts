export type CorrelationSoldRole =
  | "same_product"
  | "product"
  | "recipe"
  | "intermediate"
  | "grouping"
  | "variant";

export const CORRELATION_SOLD_ROLES: Array<{
  value: CorrelationSoldRole;
  label: string;
  hint: string;
}> = [
  {
    value: "same_product",
    label: "Unificar com produto",
    hint: "Unifica os cadastros, inclusive com um produto que já absorveu outros. Só produto com produto — não ficha nem agrupamento.",
  },
  {
    value: "product",
    label: "É um produto interno",
    hint: "Fica no catálogo. A nota continua na fila, sem unificar.",
  },
  {
    value: "recipe",
    label: "Ficha técnica",
    hint: "À direita: insumos da ficha (busca, quantidade e unidade).",
  },
  {
    value: "intermediate",
    label: "Ficha de produção",
    hint: "À direita: insumos da produção. A venda baixa o saldo produzido.",
  },
  {
    value: "grouping",
    label: "É um agrupamento",
    hint: "Nome do cardápio sem estoque. Itens da nota viram variantes, não unificam.",
  },
  {
    value: "variant",
    label: "Faz parte de um agrupamento",
    hint: "SKU com estoque ligado a um agrupamento de cardápio.",
  },
];

export function defaultSoldRoleForSameItem(
  conflictWithRecipe: boolean,
): CorrelationSoldRole {
  return conflictWithRecipe ? "recipe" : "same_product";
}

export function soldRoleHint(role: CorrelationSoldRole): string {
  return (
    CORRELATION_SOLD_ROLES.find((row) => row.value === role)?.hint ?? ""
  );
}

export function correlationRightTitle(role: CorrelationSoldRole): string {
  if (role === "same_product") return "Produto";
  if (role === "product") return "Produto interno";
  if (role === "recipe") return "Insumos da ficha";
  if (role === "intermediate") return "Insumos da produção";
  if (role === "grouping") return "Variantes";
  return "Agrupamento";
}
