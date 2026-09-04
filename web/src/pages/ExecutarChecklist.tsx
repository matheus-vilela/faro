import logoDark from "@/assets/logos/faro_logo_darkmode_transp.png";
import logoLight from "@/assets/logos/faro_logo_light_transparent.png";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useTheme } from "@/contexts/ThemeContext";
import type { ChecklistItemType } from "@/lib/checklistOperationalTypes";
import { supabase } from "@/lib/supabase";
import { ListChecks, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";

function PublicPageShell({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4">
      <Link
        to="/"
        className="absolute left-4 top-4 z-20 flex items-center transition-opacity hover:opacity-90 sm:left-6 sm:top-6"
        aria-label="Faro — início"
      >
        <img
          src={resolvedTheme === "dark" ? logoDark : logoLight}
          alt=""
          width={140}
          height={40}
          className="h-8 w-auto max-w-[min(140px,50vw)] object-contain object-left sm:h-12"
          decoding="async"
        />
      </Link>
      <div
        className="pointer-events-none absolute inset-0 bg-size-[24px_24px] bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)]"
        aria-hidden
      />
      <div className="relative z-10 w-full max-w-lg">{children}</div>
    </div>
  );
}

type ChecklistItemRow = {
  id: string;
  title: string;
  sort_order: number;
  item_type?: ChecklistItemType;
  config?: Record<string, unknown>;
  requires_evidence?: boolean;
};

type ChecklistMeta = {
  title: string;
  description: string | null;
  enforce_item_order?: boolean;
  require_geofence?: boolean;
  geofence_radius_m?: number;
};

type LoadResult = {
  ok: boolean;
  run?: { status: string; submitted_at: string | null; review_notes?: string | null };
  checklist?: ChecklistMeta;
  items?: ChecklistItemRow[];
  item_completed?: Record<string, string | null>;
  error?: string;
};

async function readGeo(): Promise<{
  lat: number;
  lng: number;
  accuracy: number;
} | null> {
  if (!navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

export function ExecutarChecklist() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LoadResult | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [index, setIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const items = useMemo(
    () =>
      [...(data?.items ?? [])].sort((a, b) => a.sort_order - b.sort_order),
    [data?.items],
  );
  const current = items[index] ?? null;
  const enforceOrder = Boolean(data?.checklist?.enforce_item_order);

  const load = useCallback(async () => {
    if (!token) {
      setError("Link inválido");
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data: res, error: err } = await supabase.rpc(
      "get_checklist_run_public",
      { p_token: token },
    );
    setLoading(false);
    if (err) {
      setError("Erro ao carregar");
      return;
    }
    const row = res as LoadResult;
    if (!row?.ok) {
      setError(
        row?.error === "already_submitted"
          ? "Este checklist está em conferência ou já foi enviado."
          : "Link inválido ou expirado.",
      );
      setData(null);
      return;
    }
    setData(row);
    const ic = row.item_completed ?? {};
    const next: Record<string, boolean> = {};
    for (const it of row.items ?? []) {
      next[it.id] = Boolean(ic[it.id]);
    }
    setChecked(next);
    if (row.run?.status === "submitted" || row.run?.status === "approved") {
      setDone(true);
    }
  }, [token]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const saveItem = async (
    item: ChecklistItemRow,
    completed: boolean,
    value?: string,
  ) => {
    if (!token) return false;
    const payload: Record<string, unknown> = {};
    const t = item.item_type ?? "check";
    if (t === "numeric" || t === "rating") payload.number = Number(value ?? 0);
    if (t === "note" || t === "barcode") payload.text = value ?? "";
    if (t === "signature") payload.signed = completed;

    const { data: res, error: err } = await supabase.rpc(
      "set_checklist_run_item_public",
      {
        p_token: token,
        p_checklist_item_id: item.id,
        p_completed: completed,
        p_value: payload,
        p_evidence_paths: [],
      },
    );
    if (err) {
      setError("Não foi possível salvar o item.");
      return false;
    }
    const row = res as { ok?: boolean; error?: string };
    if (!row?.ok) {
      if (row?.error === "order_violation") {
        setError("Conclua o item anterior primeiro.");
      } else if (row?.error === "evidence_required") {
        setError("Este item exige evidência (foto/assinatura).");
      } else {
        setError("Não foi possível salvar o item.");
      }
      return false;
    }
    setChecked((prev) => ({ ...prev, [item.id]: completed }));
    setError(null);
    return true;
  };

  const submit = async () => {
    if (!token || !data) return;
    setSubmitting(true);
    setError(null);

    let lat: number | null = null;
    let lng: number | null = null;
    let accuracy: number | null = null;
    if (data.checklist?.require_geofence) {
      const geo = await readGeo();
      if (!geo) {
        setSubmitting(false);
        setError("Ative a localização para enviar este checklist.");
        return;
      }
      lat = geo.lat;
      lng = geo.lng;
      accuracy = geo.accuracy;
    }

    const { data: res, error: err } = await supabase.rpc(
      "submit_checklist_run_public",
      {
        p_token: token,
        p_lat: lat,
        p_lng: lng,
        p_accuracy_m: accuracy,
      },
    );
    setSubmitting(false);
    if (err) {
      setError("Falha ao enviar.");
      return;
    }
    const row = res as { ok?: boolean; error?: string };
    if (!row?.ok) {
      const map: Record<string, string> = {
        incomplete: "Ainda há itens sem concluir.",
        outside_window: "Fora da janela/horário permitido.",
        outside_geofence: "Você está fora da área permitida.",
        geolocation_required: "Localização obrigatória.",
        geolocation_inaccurate: "GPS impreciso — tente novamente perto do local.",
      };
      setError(map[row?.error ?? ""] ?? "Não foi possível enviar.");
      return;
    }
    setDone(true);
  };

  if (loading) {
    return (
      <PublicPageShell>
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Carregando…
        </div>
      </PublicPageShell>
    );
  }

  if (error && !data) {
    return (
      <PublicPageShell>
        <Card>
          <CardHeader>
            <CardTitle>Checklist</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      </PublicPageShell>
    );
  }

  if (done) {
    return (
      <PublicPageShell>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ListChecks className="h-5 w-5" /> Checklist enviado
            </CardTitle>
            <CardDescription>
              Obrigado! O gestor vai conferir as respostas.
            </CardDescription>
          </CardHeader>
        </Card>
      </PublicPageShell>
    );
  }

  const allChecked =
    items.length > 0 && items.every((it) => checked[it.id] === true);
  const type = current?.item_type ?? "check";

  return (
    <PublicPageShell>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <ListChecks className="h-5 w-5" />
            {data?.checklist?.title ?? "Checklist"}
          </CardTitle>
          {data?.checklist?.description ? (
            <CardDescription>{data.checklist.description}</CardDescription>
          ) : null}
          {data?.run?.status === "needs_rework" ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
              <p className="font-medium">Devolvido para refazer</p>
              {data.run.review_notes?.trim() ? (
                <p className="mt-1 text-muted-foreground">
                  {data.run.review_notes.trim()}
                </p>
              ) : (
                <p className="mt-1 text-muted-foreground">
                  Corrija o que o gestor apontou e envie de novo neste mesmo
                  link.
                </p>
              )}
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          {current ? (
            <div className="space-y-3 rounded-xl border p-4">
              <p className="text-xs font-semibold uppercase text-muted-foreground">
                Item {index + 1} de {items.length}
              </p>
              <p className="text-lg font-bold">{current.title}</p>

              {type === "check" || type === "photo" || type === "signature" ? (
                <label className="flex items-center gap-3 text-sm">
                  <Checkbox
                    checked={Boolean(checked[current.id])}
                    onCheckedChange={(v) =>
                      void saveItem(current, v === true)
                    }
                    disabled={
                      enforceOrder &&
                      index > 0 &&
                      !checked[items[index - 1]!.id]
                    }
                  />
                  {type === "signature"
                    ? "Confirmo com minha assinatura/ciência"
                    : type === "photo"
                      ? "Marcar como feito (anexe foto depois no app completo)"
                      : "Feito"}
                </label>
              ) : null}

              {(type === "numeric" || type === "rating") && (
                <Input
                  type="number"
                  inputMode="decimal"
                  placeholder={type === "rating" ? "Nota 1–5" : "Valor"}
                  value={values[current.id] ?? ""}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [current.id]: e.target.value }))
                  }
                  onBlur={() =>
                    void saveItem(
                      current,
                      (values[current.id] ?? "").trim() !== "",
                      values[current.id],
                    )
                  }
                />
              )}

              {(type === "note" || type === "barcode") && (
                <Textarea
                  placeholder={
                    type === "barcode" ? "Código lido / digitado" : "Anotação"
                  }
                  value={values[current.id] ?? ""}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [current.id]: e.target.value }))
                  }
                  onBlur={() =>
                    void saveItem(
                      current,
                      (values[current.id] ?? "").trim() !== "",
                      values[current.id],
                    )
                  }
                />
              )}
            </div>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              disabled={index === 0}
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
            >
              Anterior
            </Button>
            {index < items.length - 1 ? (
              <Button
                type="button"
                className="flex-1"
                onClick={() => setIndex((i) => i + 1)}
              >
                Próximo
              </Button>
            ) : (
              <Button
                type="button"
                className="flex-1"
                disabled={!allChecked || submitting}
                onClick={() => void submit()}
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Enviar"
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </PublicPageShell>
  );
}
