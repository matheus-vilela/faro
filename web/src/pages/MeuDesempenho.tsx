import logoDark from "@/assets/logos/faro_logo_darkmode_transp.png";
import logoLight from "@/assets/logos/faro_logo_light_transparent.png";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useTheme } from "@/contexts/ThemeContext";
import type { StaffScoreAxes } from "@/lib/checklistOperationalTypes";
import { supabase } from "@/lib/supabase";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";

function Shell({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  return (
    <div className="relative flex min-h-screen justify-center bg-background p-4 py-10">
      <Link to="/" className="absolute left-4 top-4 z-20">
        <img
          src={resolvedTheme === "dark" ? logoDark : logoLight}
          alt=""
          className="h-8 w-auto"
        />
      </Link>
      <div className="relative z-10 w-full max-w-md pt-10">{children}</div>
    </div>
  );
}

type PerfPayload = {
  ok: boolean;
  error?: string;
  member_name?: string;
  company_name?: string;
  score?: StaffScoreAxes;
  runs?: {
    id: string;
    title: string;
    submitted_at: string | null;
    status: string;
    on_time: boolean | null;
  }[];
};

export function MeuDesempenho() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PerfPayload | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setError("Link inválido");
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data: res, error: err } = await supabase.rpc(
      "get_staff_performance_public",
      { p_token: token },
    );
    setLoading(false);
    if (err) {
      setError("Erro ao carregar desempenho.");
      return;
    }
    const row = res as PerfPayload;
    if (!row?.ok) {
      setError("Link inválido ou expirado.");
      return;
    }
    setData(row);
  }, [token]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  if (loading) {
    return (
      <Shell>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Carregando…
        </div>
      </Shell>
    );
  }

  if (error || !data) {
    return (
      <Shell>
        <Card>
          <CardHeader>
            <CardTitle>Meu desempenho</CardTitle>
            <CardDescription>{error ?? "Indisponível"}</CardDescription>
          </CardHeader>
        </Card>
      </Shell>
    );
  }

  const s = data.score ?? { prazo: 0, completo: 0, preciso: 0, score: 0 };

  return (
    <Shell>
      <Card>
        <CardHeader>
          <CardTitle>Meu desempenho</CardTitle>
          <CardDescription>
            {data.member_name}
            {data.company_name ? ` · ${data.company_name}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-2xl bg-[#0F1623] p-5 text-center text-white">
            <p className="text-xs uppercase tracking-wide text-white/60">
              Score (30 dias)
            </p>
            <p className="mt-1 text-5xl font-extrabold">{s.score}</p>
            <div className="mt-4 space-y-2 text-left text-sm">
              <ScoreBar label="Prazo" value={s.prazo} />
              <ScoreBar label="Completo" value={s.completo} />
              <ScoreBar label="Preciso" value={s.preciso} />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Tom de treinador: use os atrasos e itens incompletos para melhorar o
            próximo turno — sem punição.
          </p>
          <ul className="space-y-2">
            {(data.runs ?? []).slice(0, 12).map((r) => (
              <li
                key={r.id}
                className="rounded-lg border px-3 py-2 text-sm"
              >
                <p className="font-semibold">{r.title}</p>
                <p className="text-xs text-muted-foreground">
                  {r.submitted_at
                    ? new Date(r.submitted_at).toLocaleString("pt-BR")
                    : "—"}{" "}
                  · {r.status}
                  {r.on_time === false ? " · atrasado" : ""}
                </p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </Shell>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 text-xs text-white/80">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/15">
        <div
          className="h-full rounded-full bg-orange-400"
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
      <span className="w-8 text-right text-xs font-bold">{value}</span>
    </div>
  );
}
