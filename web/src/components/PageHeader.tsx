import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export function PageHeader({
  title,
  description,
  icon: Icon,
  action,
  className,
  iconClassName,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: LucideIcon;
  action?: React.ReactNode;
  className?: string;
  /** Classes extras no ícone ao lado do título (ex.: cor de marca). */
  iconClassName?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6",
        className,
      )}
    >
      <div className="min-w-0">
        {Icon ? (
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <Icon
              className={cn("h-7 w-7 shrink-0 text-primary", iconClassName)}
              aria-hidden
            />
            {title}
          </h1>
        ) : (
          <h1 className="text-xl font-bold tracking-tight">{title}</h1>
        )}
        {description != null && description !== false && (
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action ? (
        <div className="w-full shrink-0 sm:mt-0.5 sm:w-auto">{action}</div>
      ) : null}
    </div>
  );
}
