import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

export function LegalPageLayout({
  title,
  children,
  wide,
}: {
  title: string;
  children: React.ReactNode;
  /** Largura extra para documentos com tabelas (ex.: política de privacidade). */
  wide?: boolean;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60 bg-background/95 backdrop-blur-sm">
        <div
          className={cn(
            "mx-auto flex h-14 items-center px-4 sm:px-6",
            wide ? "max-w-4xl" : "max-w-3xl",
          )}
        >
          <Button variant="ghost" size="sm" className="gap-2" asChild>
            <Link to="/">
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Voltar ao início
            </Link>
          </Button>
        </div>
      </header>
      <main
        className={cn(
          "mx-auto px-4 py-10 sm:px-6 sm:py-14",
          wide ? "max-w-4xl" : "max-w-3xl",
        )}
      >
        <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {title}
        </h1>
        <div className="mt-8 space-y-4 text-sm leading-relaxed text-muted-foreground sm:text-[0.9375rem]">
          {children}
        </div>
      </main>
    </div>
  );
}
