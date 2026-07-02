import { Badge } from "@/components/ui/badge";
import { formatBulkEditPreviewDisplay } from "@/lib/productBulkEditFields";
import type { BulkEditFieldKey, BulkEditPreviewItem } from "@/types/productBulkEdit";
import { AlertTriangle } from "lucide-react";

export function ProductBulkEditPreviewTable({
  items,
  totalCount,
  truncated,
  fieldKey,
  productCategoryNames,
  cmvCategoryNames,
}: {
  items: BulkEditPreviewItem[];
  totalCount: number;
  truncated: boolean;
  fieldKey: BulkEditFieldKey;
  productCategoryNames: Record<string, string>;
  cmvCategoryNames: Record<string, string>;
}) {
  const lookups = { productCategoryNames, cmvCategoryNames };

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        {totalCount} produto(s) serão alterados
        {truncated ? " (mostrando os primeiros 100 na pré-visualização)" : ""}.
      </p>
      <div className="max-h-[min(50vh,420px)] overflow-auto rounded-md border">
        <table className="w-full caption-bottom text-sm">
          <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
            <tr className="border-b">
              <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">
                Produto
              </th>
              <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">
                Antes
              </th>
              <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground">
                Depois
              </th>
              <th className="h-10 w-[100px] px-3 text-left align-middle font-medium text-muted-foreground">
                Alertas
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.product_id} className="border-b last:border-0">
                <td className="max-w-[200px] truncate p-3 align-middle font-medium">
                  {item.product_name}
                </td>
                <td className="max-w-[220px] truncate p-3 align-middle text-muted-foreground">
                  {formatBulkEditPreviewDisplay(fieldKey, item.before, lookups)}
                </td>
                <td className="max-w-[220px] truncate p-3 align-middle">
                  {formatBulkEditPreviewDisplay(fieldKey, item.after, lookups)}
                </td>
                <td className="p-3 align-middle">
                  {item.warnings.length > 0 ? (
                    <Badge
                      variant="outline"
                      className="gap-1 border-amber-500/40 text-[0.65rem] font-normal"
                      title={item.warnings.join(" ")}
                    >
                      <AlertTriangle className="h-3 w-3" />
                      {item.warnings.length}
                    </Badge>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
