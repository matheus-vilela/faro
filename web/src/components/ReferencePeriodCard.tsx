import { MonthSelector, type MonthYear } from "@/components/MonthSelector";
import { cn } from "@/lib/utils";
import { CalendarDays } from "lucide-react";

const DEFAULT_SELECTOR_CLASS =
  "shrink-0 [&_button]:h-10 [&_button]:w-10 [&_button]:border-primary/35 [&_button]:bg-background [&_button]:shadow-sm [&_button]:hover:bg-primary/10 [&_span]:min-w-46 [&_span]:text-base [&_span]:font-semibold sm:[&_span]:min-w-52 sm:[&_span]:text-lg";

export type ReferencePeriodCardProps = {
  value: MonthYear;
  onChange: (value: MonthYear) => void;
  /** Padrão: "Período de referência" */
  title?: string;
  /** Texto auxiliar abaixo do título */
  description?: string;
  className?: string;
  monthSelectorClassName?: string;
  compact?: boolean;
};

export function ReferencePeriodCard({
  value,
  onChange,
  title = "Período de referência",
  description,
  className,
  monthSelectorClassName,
  compact = false,
}: ReferencePeriodCardProps) {
  return (
    <div
      className={cn(
        "w-fit max-w-full rounded-xl border border-primary/25 bg-linear-to-br from-primary/12 via-primary/5 to-transparent p-4 shadow-sm dark:from-primary/15 dark:via-primary/8",
        compact && "rounded-lg p-1.5 shadow-none",
        className,
      )}
    >
      <div
        className={cn(
          "flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:gap-4",
          compact && "gap-2 sm:gap-2",
        )}
      >
        {!compact ? (
          <div className="flex shrink-0 items-center gap-3">
            <div
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary shadow-inner ring-1 ring-primary/20"
              aria-hidden
            >
              <CalendarDays className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{title}</p>
              {description ? (
                <p className="text-xs text-muted-foreground">{description}</p>
              ) : null}
            </div>
          </div>
        ) : (
          <span className="sr-only">{title}</span>
        )}
        <MonthSelector
          value={value}
          onChange={onChange}
          className={monthSelectorClassName ?? DEFAULT_SELECTOR_CLASS}
        />
      </div>
    </div>
  );
}
