import { supabase } from "@/lib/supabase";
import { FileText } from "lucide-react";
import { useEffect, useState } from "react";

type Props = {
  path: string | null | undefined;
  className?: string;
};

/** Miniatura ou ícone quando existe comprovante no Storage (URL assinada). */
export function ExpenseSourceThumb({ path, className }: Props) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!path?.trim()) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.storage
        .from("expense-documents")
        .createSignedUrl(path.trim(), 3600);
      if (!cancelled && !error && data?.signedUrl) setUrl(data.signedUrl);
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (!path?.trim()) return null;

  const isImage = /\.(jpe?g|png|webp|gif)$/i.test(path);

  if (url && isImage) {
    return (
      <img
        src={url}
        alt=""
        className={
          className ??
          "h-11 w-11 shrink-0 rounded-md border object-cover bg-muted"
        }
      />
    );
  }

  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={
          className ??
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground hover:bg-muted/80"
        }
        title="Abrir comprovante"
        onClick={(e) => e.stopPropagation()}
      >
        <FileText className="h-5 w-5" />
      </a>
    );
  }

  return (
    <span
      className={
        className ??
        "flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-dashed text-muted-foreground"
      }
      title="Comprovante"
    >
      <FileText className="h-5 w-5 animate-pulse" />
    </span>
  );
}
