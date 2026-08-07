import { supabase } from "@/lib/supabase";
import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

export function RedirectStaffPerformanceSlug() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) {
      setErr("Link inválido");
      return;
    }
    void (async () => {
      const { data, error } = await supabase.rpc(
        "get_staff_performance_token_by_slug",
        { p_slug: slug },
      );
      if (error || !data) {
        setErr("Link inválido ou expirado.");
        return;
      }
      navigate(`/desempenho/${data as string}`, { replace: true });
    })();
  }, [slug, navigate]);

  if (err) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 text-sm text-muted-foreground">
        {err}
      </div>
    );
  }
  return (
    <div className="flex min-h-screen items-center justify-center gap-2 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" /> Abrindo…
    </div>
  );
}
