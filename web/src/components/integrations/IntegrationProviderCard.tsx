import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ChevronRight, Loader2 } from "lucide-react";
import type { ReactNode } from "react";

export type IntegrationCardStatus = "active" | "inactive" | "warning";

const STATUS_CLASS: Record<IntegrationCardStatus, string> = {
  active:
    "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-400",
  warning:
    "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200",
  inactive: "border-border bg-muted/60 text-muted-foreground",
};

const STATUS_DOT: Record<IntegrationCardStatus, string> = {
  active: "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.25)]",
  warning: "bg-amber-500 shadow-[0_0_0_3px_rgba(245,158,11,0.25)]",
  inactive: "bg-muted-foreground/50",
};

export function IntegrationProviderCardSkeleton() {
  return (
    <Card className="flex h-full min-h-44 w-full items-center justify-center gap-0 py-0">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </Card>
  );
}

export function IntegrationProviderCard({
  title,
  description,
  status,
  statusLabel,
  meta,
  actionLabel,
  onOpen,
  brand,
}: {
  title: string;
  description: string;
  status: IntegrationCardStatus;
  statusLabel: string;
  meta?: string;
  actionLabel: string;
  onOpen: () => void;
  brand: ReactNode;
}) {
  return (
    <Card className="h-full w-full gap-0 overflow-hidden py-0 shadow-sm">
      <div className="relative h-20 shrink-0 border-b bg-muted/40">{brand}</div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold tracking-tight text-foreground">
            {title}
          </h3>
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              STATUS_CLASS[status],
            )}
          >
            <span
              className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[status])}
              aria-hidden
            />
            {statusLabel}
          </span>
        </div>
        <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">
          {description}
        </p>
        {meta ? (
          <p className="line-clamp-1 text-[11px] text-muted-foreground">
            {meta}
          </p>
        ) : null}
        <div className="mt-auto pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 w-full justify-between text-xs"
            onClick={onOpen}
          >
            {actionLabel}
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
