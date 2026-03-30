import { cn } from "@/lib/utils";

export function PageShell({
  children,
  narrow,
  className,
}: {
  children: React.ReactNode;
  narrow?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "w-full space-y-4 pb-10",
        narrow && "mx-auto max-w-4xl",
        className,
      )}
    >
      {children}
    </div>
  );
}
