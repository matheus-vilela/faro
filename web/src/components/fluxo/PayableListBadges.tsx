import { Badge } from "@/components/ui/badge";
import {
  PAYABLE_ORIGIN_LABEL,
  PAYABLE_SITUATION_LABEL,
  payableOriginIcon,
  type PayableOrigin,
  type PayableSituation,
} from "@/lib/payableListViews";
import { cn } from "@/lib/utils";

const SITUATION_CLASS: Record<PayableSituation, string> = {
  overdue:
    "border-transparent bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
  due_today:
    "border-transparent bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300",
  scheduled:
    "border-transparent bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
  pending:
    "border-transparent bg-muted text-muted-foreground",
};

const ORIGIN_CLASS: Record<PayableOrigin, string> = {
  whatsapp:
    "border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  sefaz:
    "border-transparent bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300",
  automatic:
    "border-transparent bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300",
  manual:
    "border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
};

export function PayableSituationBadge({
  situation,
  className,
}: {
  situation: PayableSituation;
  className?: string;
}) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        "font-medium",
        SITUATION_CLASS[situation],
        className,
      )}
    >
      {PAYABLE_SITUATION_LABEL[situation]}
    </Badge>
  );
}

export function PayableOriginBadge({
  origin,
  className,
}: {
  origin: PayableOrigin;
  className?: string;
}) {
  const Icon = payableOriginIcon(origin);
  return (
    <Badge
      variant="secondary"
      className={cn(
        "gap-1 font-medium",
        ORIGIN_CLASS[origin],
        className,
      )}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      {PAYABLE_ORIGIN_LABEL[origin]}
    </Badge>
  );
}
