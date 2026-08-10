import { Dog } from "lucide-react";
import { cn } from "@/lib/utils";

export function DashboardHomeInsightBand({
  greeting,
  firstName,
  text,
  className,
}: {
  greeting: string;
  firstName: string;
  text: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex gap-3.5 rounded-xl border border-border/80 border-l-[3px] border-l-primary bg-card p-4 shadow-sm sm:p-5",
        className,
      )}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Dog className="h-5 w-5" aria-hidden />
      </div>
      <p className="min-w-0 text-sm leading-relaxed text-foreground sm:text-[15px]">
        <strong>
          {greeting}, {firstName}
        </strong>{" "}
        {text}
      </p>
    </div>
  );
}
