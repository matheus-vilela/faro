import { Button } from "@/components/ui/button";
import type { PayableListView } from "@/lib/payableListViews";
import { cn } from "@/lib/utils";

const OPTIONS: { value: PayableListView; label: string }[] = [
  { value: "category", label: "Por categoria" },
  { value: "due", label: "Por vencimento" },
  { value: "status", label: "Por situação" },
];

export function PayableListViewToggle({
  value,
  onChange,
  className,
}: {
  value: PayableListView;
  onChange: (value: PayableListView) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex max-w-full flex-wrap rounded-full bg-muted p-1",
        className,
      )}
      role="tablist"
      aria-label="Visão da lista"
    >
      {OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <Button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            variant="ghost"
            size="sm"
            onClick={() => onChange(opt.value)}
            className={cn(
              "h-8 rounded-full px-3 text-sm font-medium shadow-none",
              active
                ? "bg-background text-foreground shadow-sm hover:bg-background"
                : "text-muted-foreground hover:bg-transparent hover:text-foreground",
            )}
          >
            {opt.label}
          </Button>
        );
      })}
    </div>
  );
}
