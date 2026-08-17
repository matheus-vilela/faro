import { Dog } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function FaroTipBand({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex gap-3.5 rounded-xl border border-sky-500/25 border-l-[3px] border-l-sky-500 bg-card bg-linear-to-br from-sky-500/[0.07] to-sky-500/[0.07] p-4 shadow-sm sm:p-5",
        className,
      )}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500 text-white">
        <Dog className="h-5 w-5" aria-hidden />
      </div>
      <p className="min-w-0 text-sm leading-relaxed text-foreground sm:text-[15px]">
        {children}
      </p>
    </div>
  );
}
