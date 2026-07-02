import { Button } from "@/components/ui/button";
import { undoProductBulkEdit } from "@/lib/productBulkEdit";
import { bulkEditFieldLabel } from "@/lib/productBulkEditFields";
import { cn } from "@/lib/utils";
import type { BulkEditOperationSummary } from "@/types/productBulkEdit";
import { Loader2, Undo2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

function formatBulkEditDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function ProductBulkEditUndoBanner({
  companyId,
  operation,
  className,
  onUndone,
}: {
  companyId: string;
  operation: BulkEditOperationSummary;
  className?: string;
  onUndone?: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const handleUndo = async () => {
    setBusy(true);
    const result = await undoProductBulkEdit(companyId, operation.id);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(
      `Edição em lote desfeita (${result.restored_count} produto(s) restaurados).`,
    );
    onUndone?.();
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/[0.07] p-4 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
      role="status"
    >
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-semibold text-foreground">
          Edição em lote aplicada
        </p>
        <p className="text-xs text-muted-foreground">
          {bulkEditFieldLabel(operation.field_key)} em {operation.updated_count}{" "}
          produto(s) · {formatBulkEditDate(operation.created_at)} · desfazer até{" "}
          {formatBulkEditDate(operation.expires_at)}
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0 gap-1.5"
        disabled={busy}
        onClick={() => void handleUndo()}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Undo2 className="h-4 w-4" />
        )}
        Desfazer
      </Button>
    </div>
  );
}
