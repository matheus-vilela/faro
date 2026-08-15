import { Badge } from "@/components/ui/badge";
import {
  catalogActionLabel,
  previewEpocProdutoVendasInterpret,
  skipReasonLabel,
  type ProdutoVendaCatalogAction,
  type ProdutoVendasInterpretPreview,
} from "@/lib/epocProdutoVendasInterpret";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

function formatBrl(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatQty(value: number): string {
  return value.toLocaleString("pt-BR", {
    maximumFractionDigits: 3,
  });
}

function actionBadgeClass(action: ProdutoVendaCatalogAction): string {
  switch (action) {
    case "create_product":
      return "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100";
    case "match_product":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100";
    case "match_recipe":
      return "border-sky-500/40 bg-sky-500/10 text-sky-900 dark:text-sky-100";
    case "manual_review":
      return "border-destructive/40 bg-destructive/10 text-destructive";
  }
}

export async function runEpocProdutoVendasInterpret(
  companyId: string,
  text: string,
  fileName: string,
): Promise<ProdutoVendasInterpretPreview> {
  const [productsRes, recipesRes] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, unit, is_active")
      .eq("company_id", companyId),
    supabase.from("recipes").select("id, name").eq("company_id", companyId),
  ]);
  if (productsRes.error) throw productsRes.error;
  if (recipesRes.error) throw recipesRes.error;

  return previewEpocProdutoVendasInterpret(text, fileName, {
    products: (productsRes.data ?? []) as Array<{
      id: string;
      name: string;
      unit?: string | null;
      is_active?: boolean | null;
    }>,
    recipes: (recipesRes.data ?? []) as Array<{ id: string; name: string }>,
  });
}

export function EpocVendaProdutosInterpretResult({
  preview,
}: {
  preview: ProdutoVendasInterpretPreview;
}) {
  return (
    <div className="space-y-6">
      <div className="text-muted-foreground space-y-1 text-sm">
        <p>
          Arquivo: <span className="text-foreground">{preview.fileName}</span>
          {" · "}
          {preview.totals.rawRows} linha(s) brutas
        </p>
        {!preview.ok && preview.error ? (
          <p className="text-destructive">{preview.error}</p>
        ) : null}
      </div>

      {preview.ok ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryTile
              label="Linhas válidas"
              value={String(preview.totals.validLines)}
              hint={`${preview.totals.skippedLines} ignorada(s)`}
            />
            <SummaryTile
              label="Total bruto"
              value={formatBrl(preview.totals.totalRecebido)}
              hint={`${formatQty(preview.totals.quantity)} un · ${preview.totals.days} dia(s)`}
            />
            <SummaryTile
              label="Criar produto"
              value={String(preview.totals.wouldCreateProducts)}
              hint="nomes sem match no cadastro"
            />
            <SummaryTile
              label="Já cadastrados"
              value={String(
                preview.totals.wouldMatchProducts +
                  preview.totals.wouldMatchRecipes,
              )}
              hint={`${preview.totals.wouldMatchProducts} produto(s) · ${preview.totals.wouldMatchRecipes} ficha(s)`}
            />
          </div>

          <section className="space-y-2">
            <h4 className="text-sm font-medium">Por dia</h4>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[36rem] text-left text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Data</th>
                    <th className="px-3 py-2 text-right font-medium">Linhas</th>
                    <th className="px-3 py-2 text-right font-medium">Qtde</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Produtos
                    </th>
                    <th className="px-3 py-2 text-right font-medium">Criar</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Existente
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {preview.days.map((d) => (
                    <tr
                      key={d.dataIso}
                      className="border-b border-border/60 last:border-0"
                    >
                      <td className="px-3 py-2 font-medium">{d.dataLabel}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {d.lineCount}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatQty(d.quantity)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatBrl(d.totalRecebido)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {d.uniqueProducts}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {d.wouldCreate}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {d.wouldMatch}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-2">
            <h4 className="text-sm font-medium">
              Por produto ({preview.products.length})
            </h4>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[44rem] text-left text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Ação</th>
                    <th className="px-3 py-2 font-medium">Produto CSV</th>
                    <th className="px-3 py-2 font-medium">Match</th>
                    <th className="px-3 py-2 text-right font-medium">Linhas</th>
                    <th className="px-3 py-2 text-right font-medium">Qtde</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                    <th className="px-3 py-2 text-right font-medium">
                      Preço méd.
                    </th>
                    <th className="px-3 py-2 text-right font-medium">Dias</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.products.map((p) => (
                    <tr
                      key={p.key}
                      className="border-b border-border/60 last:border-0"
                    >
                      <td className="px-3 py-2">
                        <Badge
                          variant="outline"
                          className={cn(
                            "font-normal",
                            actionBadgeClass(p.catalogAction),
                          )}
                        >
                          {catalogActionLabel(p.catalogAction)}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 font-medium">{p.productName}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {p.matchedLabel
                          ? `${p.matchedLabel}${p.matchedUnit ? ` (${p.matchedUnit})` : ""}`
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {p.lineCount}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatQty(p.quantity)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatBrl(p.totalRecebido)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {p.avgUnitPrice != null
                          ? formatBrl(p.avgUnitPrice)
                          : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {p.days.length}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {preview.skipped.length > 0 ? (
            <section className="space-y-2">
              <h4 className="text-sm font-medium text-amber-800 dark:text-amber-200">
                Linhas ignoradas ({preview.skipped.length})
              </h4>
              <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-3 text-sm">
                {preview.skipped.slice(0, 60).map((s) => (
                  <li key={`${s.rowNumber}-${s.reason}`}>
                    <span className="font-mono text-xs">L{s.rowNumber}</span>
                    {" · "}
                    {skipReasonLabel(s.reason)}
                    {s.productName ? ` · ${s.productName}` : ""}
                    {" · "}
                    <span className="text-muted-foreground">{s.detail}</span>
                  </li>
                ))}
                {preview.skipped.length > 60 ? (
                  <li className="text-muted-foreground">
                    … e mais {preview.skipped.length - 60}
                  </li>
                ) : null}
              </ul>
            </section>
          ) : null}

          <p className="text-muted-foreground text-xs">
            Colunas usadas: data=
            {preview.headers[preview.columns.dataConsumo] ?? "—"}, produto=
            {preview.headers[preview.columns.produto] ?? "—"}, qtde=
            {preview.headers[preview.columns.quantidade] ?? "—"}, total=
            {preview.headers[preview.columns.totalRecebido] ?? "—"}. Match
            exato por nome (sem OpenAI); nomes novos seriam criados no import
            real.
          </p>
        </>
      ) : null}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2">
      <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
        {label}
      </p>
      <p className="text-foreground text-lg font-semibold tabular-nums">
        {value}
      </p>
      <p className="text-muted-foreground text-xs">{hint}</p>
    </div>
  );
}
