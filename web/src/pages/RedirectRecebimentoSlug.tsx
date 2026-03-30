import { supabase } from "@/lib/supabase";
import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";

/**
 * /s/:slug → resolve token via RPC e redireciona para /c/:token (confirmação).
 */
export function RedirectRecebimentoSlug() {
  const { slug } = useParams<{ slug: string }>();
  const [token, setToken] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!slug?.trim()) {
      setErr("Link inválido");
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.rpc(
        "get_recebimento_token_by_short_slug",
        { p_slug: slug },
      );
      if (cancelled) return;
      if (error) {
        setErr("Não foi possível abrir o link.");
        return;
      }
      if (data == null || data === "") {
        setErr("Link inválido ou expirado.");
        return;
      }
      setToken(String(data));
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (err) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">{err}</p>
      </div>
    );
  }
  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Carregando…</p>
      </div>
    );
  }
  return <Navigate to={`/c/${token}`} replace />;
}
