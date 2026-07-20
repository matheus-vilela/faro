import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { GitBranch } from "lucide-react";

export type StagingInterpretPreviewPlannedProduct = {
  preview_product_id: string;
  name: string;
  unit: string;
  ncm: string;
  cfop: string | null;
  csosn: string | null;
  ean: string | null;
  conversions: Array<{
    primary_qty: number;
    primary_unit_code: string;
    secondary_qty: number;
    secondary_unit_code: string;
    relation?: string;
  }>;
  registration_note: string | null;
  estoque_entrada_preview?: Record<string, unknown>;
  criterio_criacao: string;
  criterio_descricao: string;
};

export type StagingInterpretPreviewLine = {
  line_index: number;
  nome: string;
  ncm: string | null;
  ean: string | null;
  action: string;
  product_id: string | null;
  product_name?: string | null;
  criterio?: string;
  planned_product?: StagingInterpretPreviewPlannedProduct;
};

export type StagingInterpretPreviewResult = {
  supplier: {
    document_digits: string | null;
    action: string;
    existing_supplier_id?: string | null;
    existing_supplier_name?: string | null;
    planned_insert?: { name: string; document: string; notes: string };
  };
  products_by_line: StagingInterpretPreviewLine[];
  expense: {
    would_create: boolean;
    skip_reason?: string;
    duplicate_expense_id?: string | null;
    document_total: number | null;
    planned_items: Array<Record<string, unknown>>;
    would_finalize_recebimento_and_stock: boolean;
  };
  boletos: Array<Record<string, unknown>>;
  meta: {
    catalog_size: number;
    openai_configured: boolean;
    catalog_fetch_error: string | null;
    unified_catalog_note: string;
  };
};

const ACTION_LABELS: Record<string, string> = {
  link_ean: "Vincular (EAN)",
  link_cprod_supplier: "Vincular (cProd + fornecedor)",
  reuse_chunk_dedupe: "Reutilizar (dedupe chunk)",
  create_product: "Criar produto",
  skip_fiscal_incomplete: "Ignorar (fiscal incompleto)",
};

function supplierActionLabel(action: string): string {
  if (action === "link_existing") return "Usar fornecedor existente";
  if (action === "would_create") return "Criar fornecedor";
  if (action === "invalid_document") return "Documento inválido";
  return action;
}

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function NfeStagingInterpretPreviewCard({
  preview,
  error,
}: {
  preview: StagingInterpretPreviewResult | null | undefined;
  error?: string | null;
}) {
  if (error) {
    return (
      <Card className="border-amber-500/40">
        <CardHeader>
          <CardTitle className="text-base">Interpretação staging</CardTitle>
          <CardDescription>
            Não foi possível simular{" "}
            <code className="text-xs">focus-get-sync-nfe-interpret-staging</code>
            : {error}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!preview) {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-base">Interpretação staging</CardTitle>
          <CardDescription>
            Envie o XML com uma unidade selecionada para simular fornecedor,
            produtos e despesa.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const { supplier, products_by_line, expense, boletos, meta } = preview;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <GitBranch className="h-4 w-4" />
          Interpretação staging (dry-run)
        </CardTitle>
        <CardDescription>
          Mesma lógica de{" "}
          <code className="rounded bg-muted px-1 text-xs">
            focus-get-sync-nfe-interpret-staging
          </code>
          . Catálogo: {meta.catalog_size} produtos
          {" · match: EAN / cProd+fornecedor"}
          {meta.catalog_fetch_error
            ? ` · Erro catálogo: ${meta.catalog_fetch_error}`
            : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 text-sm">
        <section className="space-y-2">
          <h3 className="font-medium">Fornecedor</h3>
          <p>
            <span className="text-muted-foreground">Ação:</span>{" "}
            {supplierActionLabel(supplier.action)}
          </p>
          {supplier.document_digits ? (
            <p className="font-mono text-xs">{supplier.document_digits}</p>
          ) : null}
          {supplier.existing_supplier_id ? (
            <p className="text-xs text-muted-foreground">
              ID: {supplier.existing_supplier_id}
              {supplier.existing_supplier_name
                ? ` — ${supplier.existing_supplier_name}`
                : null}
            </p>
          ) : null}
          {supplier.planned_insert ? (
            <pre className="overflow-auto rounded border bg-muted/30 p-2 text-xs font-mono">
              {JSON.stringify(supplier.planned_insert, null, 2)}
            </pre>
          ) : null}
        </section>

        <section className="space-y-2">
          <h3 className="font-medium">Produtos por linha</h3>
          <div className="overflow-auto rounded border">
            <table className="w-full min-w-[640px] text-xs">
              <thead>
                <tr className="border-b bg-muted/40 text-left">
                  <th className="p-2">#</th>
                  <th className="p-2">Item</th>
                  <th className="p-2">Ação</th>
                  <th className="p-2">Produto</th>
                  <th className="p-2">Conversões</th>
                </tr>
              </thead>
              <tbody>
                {products_by_line.map((row) => (
                  <tr key={row.line_index} className="border-b align-top">
                    <td className="p-2 font-mono">{row.line_index + 1}</td>
                    <td className="p-2 max-w-[200px]">
                      <div className="font-medium">{row.nome}</div>
                      <div className="text-muted-foreground">
                        NCM {row.ncm ?? "—"}
                        {row.ean ? ` · EAN ${row.ean}` : ""}
                      </div>
                    </td>
                    <td className="p-2">
                      {ACTION_LABELS[row.action] ?? row.action}
                      {row.criterio ? (
                        <div className="text-muted-foreground">{row.criterio}</div>
                      ) : null}
                    </td>
                    <td className="p-2 font-mono text-[11px]">
                      {row.product_id ?? "—"}
                      {row.product_name ? (
                        <div className="font-sans text-foreground">
                          {row.product_name}
                        </div>
                      ) : null}
                      {row.planned_product ? (
                        <div className="mt-1 font-sans text-foreground">
                          Novo: {row.planned_product.name} ({row.planned_product.unit})
                        </div>
                      ) : null}
                    </td>
                    <td className="p-2 text-[11px]">
                      {row.planned_product?.conversions?.length ? (
                        <ul className="list-disc pl-4 space-y-0.5">
                          {row.planned_product.conversions.map((c, i) => (
                            <li key={i}>
                              {c.primary_qty} {c.primary_unit_code} = {c.secondary_qty}{" "}
                              {c.secondary_unit_code}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="font-medium">Despesa</h3>
          <p>
            {expense.would_create
              ? "Seria criada"
              : `Não criaria${expense.skip_reason ? ` (${expense.skip_reason})` : ""}`}
            {expense.duplicate_expense_id
              ? ` — duplicata ${expense.duplicate_expense_id}`
              : null}
          </p>
          {expense.document_total != null ? (
            <p>
              Total documento:{" "}
              <span className="font-medium">
                {BRL.format(expense.document_total)}
              </span>
            </p>
          ) : null}
          {expense.would_finalize_recebimento_and_stock ? (
            <p className="text-muted-foreground text-xs">
              Após insert: recebimento concluído + entrada de estoque (RPC).
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Itens planejados: {expense.planned_items.length}
          </p>
        </section>

        {boletos.length > 0 ? (
          <section className="space-y-2">
            <h3 className="font-medium">Boletos ({boletos.length})</h3>
            <pre className="max-h-40 overflow-auto rounded border bg-muted/30 p-2 text-xs font-mono">
              {JSON.stringify(boletos, null, 2)}
            </pre>
          </section>
        ) : null}

        <p className="text-xs text-muted-foreground">{meta.unified_catalog_note}</p>
      </CardContent>
    </Card>
  );
}
