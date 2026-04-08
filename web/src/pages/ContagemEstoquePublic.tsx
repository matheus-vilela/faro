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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTheme } from "@/contexts/ThemeContext";
import { supabase } from "@/lib/supabase";
import { ClipboardList, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";

function PublicPageShell({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  return (
    <div className="relative flex min-h-screen justify-center overflow-y-auto bg-background p-4 py-10">
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
        className="pointer-events-none fixed inset-0 bg-size-[24px_24px] bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)]"
        aria-hidden
      />
      <div className="relative z-10 w-full max-w-2xl pt-10">{children}</div>
    </div>
  );
}

type ProductLine = {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  current_quantity: number;
};

type GroupOption = { id: string; name: string };

type LoadJson = {
  ok: boolean;
  error?: string;
  company_name?: string;
  group_name?: string;
  assigned_to_name?: string;
  products?: ProductLine[];
  inventory_count_group_id?: string | null;
  group_locked?: boolean;
  requires_group_selection?: boolean;
  needs_panel_group_setup?: boolean;
  groups?: GroupOption[];
};

export function ContagemEstoquePublic() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [groupName, setGroupName] = useState("");
  const [assignedToName, setAssignedToName] = useState("");
  const [products, setProducts] = useState<ProductLine[]>([]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [groupOptions, setGroupOptions] = useState<GroupOption[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [groupLocked, setGroupLocked] = useState(false);
  const [requiresGroupSelection, setRequiresGroupSelection] = useState(false);
  const [needsPanelGroupSetup, setNeedsPanelGroupSetup] = useState(false);

  const load = useCallback(async () => {
    if (!token) {
      setError("Link inválido");
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data: res, error: err } = await supabase.rpc(
      "get_inventory_count_public",
      { p_token: token },
    );
    setLoading(false);
    if (err) {
      setError("Erro ao carregar a contagem.");
      return;
    }
    const row = res as LoadJson;
    if (!row?.ok) {
      setError(
        row?.error === "closed"
          ? "Esta contagem já foi enviada ou o link expirou."
          : "Link inválido ou expirado.",
      );
      return;
    }
    const list = row.products ?? [];
    setCompanyName(row.company_name ?? "");
    setGroupName((row.group_name ?? "").trim());
    setAssignedToName((row.assigned_to_name ?? "").trim());
    setGroupLocked(row.group_locked === true);
    setRequiresGroupSelection(row.requires_group_selection === true);
    setNeedsPanelGroupSetup(row.needs_panel_group_setup === true);
    const rawG = row.groups;
    const parsed: GroupOption[] = Array.isArray(rawG)
      ? rawG
          .map((g) => ({
            id: String((g as GroupOption).id ?? ""),
            name: String((g as GroupOption).name ?? ""),
          }))
          .filter((g) => g.id)
      : [];
    setGroupOptions(parsed);
    setSelectedGroupId("");
    setProducts(list);
    const initial: Record<string, string> = {};
    for (const p of list) {
      initial[p.id] = String(p.current_quantity ?? 0);
    }
    setCounts(initial);
  }, [token]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const submitBlocked =
    needsPanelGroupSetup ||
    (requiresGroupSelection && !selectedGroupId) ||
    products.length === 0;

  const submit = async () => {
    if (!token) return;
    if (submitBlocked && !done) return;
    const lines = products.map((p) => ({
      product_id: p.id,
      counted_qty: parseFloat(counts[p.id] ?? "0") || 0,
    }));
    setSubmitting(true);
    const { data: res, error: err } = await supabase.rpc(
      "submit_inventory_count_public",
      {
        p_token: token,
        p_lines: lines,
        p_inventory_count_group_id:
          requiresGroupSelection && selectedGroupId
            ? selectedGroupId
            : null,
      },
    );
    setSubmitting(false);
    if (err) {
      setError("Não foi possível enviar. Tente novamente.");
      return;
    }
    const row = res as { ok?: boolean; error?: string };
    if (!row?.ok) {
      setError(
        row?.error === "already_submitted"
          ? "Esta contagem já foi enviada."
          : row?.error === "group_required"
            ? "Selecione o grupo de contagem antes de enviar."
            : row?.error === "invalid_group"
              ? "Grupo inválido. Recarregue a página e tente de novo."
              : "Não foi possível salvar.",
      );
      return;
    }
    setDone(true);
  };

  if (loading) {
    return (
      <PublicPageShell>
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Carregando…
        </div>
      </PublicPageShell>
    );
  }

  if (error && !done) {
    return (
      <PublicPageShell>
        <Card>
          <CardHeader>
            <CardTitle>Contagem de estoque</CardTitle>
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
              <ClipboardList className="h-5 w-5" />
              Contagem enviada
            </CardTitle>
            <CardDescription>
              O estoque foi atualizado com as quantidades informadas. Obrigado.
            </CardDescription>
          </CardHeader>
        </Card>
      </PublicPageShell>
    );
  }

  return (
    <PublicPageShell>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" />
            Contagem de estoque
          </CardTitle>
          <CardDescription className="space-y-1">
            {companyName ? (
              <p>
                <span className="font-medium text-foreground">{companyName}</span>
              </p>
            ) : null}
            {groupLocked && groupName ? (
              <p className="text-sm">
                <span className="text-muted-foreground">Grupo (definido no painel):</span>{" "}
                <span className="font-medium text-foreground">{groupName}</span>
              </p>
            ) : null}
            {!groupLocked && requiresGroupSelection ? (
              <p className="text-sm text-muted-foreground">
                Esta sessão não tem grupo fixo: escolha abaixo a qual grupo esta
                contagem se refere.
              </p>
            ) : null}
            {needsPanelGroupSetup ? (
              <p className="text-sm text-amber-700 dark:text-amber-500">
                Não há grupos de contagem cadastrados para esta empresa. Peça a
                quem administra o Faro para cadastrar em Produtos → Contagem
                antes de enviar a contagem.
              </p>
            ) : null}
            {assignedToName ? (
              <p className="text-sm">
                <span className="text-muted-foreground">Operador designado:</span>{" "}
                <span className="font-medium text-foreground">
                  {assignedToName}
                </span>
              </p>
            ) : null}
            <p>
              Informe a quantidade física de cada item. O sistema calculará os
              ajustes em relação ao saldo atual.
            </p>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!groupLocked && requiresGroupSelection && groupOptions.length > 0 ? (
            <div className="space-y-2">
              <Label htmlFor="count-group">Grupo da contagem *</Label>
              <Select
                value={selectedGroupId || ""}
                onValueChange={setSelectedGroupId}
              >
                <SelectTrigger id="count-group" className="w-full">
                  <SelectValue placeholder="Selecione o grupo" />
                </SelectTrigger>
                <SelectContent>
                  {groupOptions.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="max-h-[min(60vh,480px)] space-y-3 overflow-y-auto pr-1">
            {products.map((p) => (
              <div
                key={p.id}
                className="flex flex-col gap-1 rounded-lg border border-border/80 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium leading-snug">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Sistema: {Number(p.current_quantity).toLocaleString("pt-BR")}{" "}
                    {p.unit}
                    {p.sku ? ` · ${p.sku}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-muted-foreground">Contado</span>
                  <Input
                    type="number"
                    step="0.0001"
                    min="0"
                    className="w-28 tabular-nums"
                    value={counts[p.id] ?? ""}
                    onChange={(e) =>
                      setCounts((c) => ({ ...c, [p.id]: e.target.value }))
                    }
                  />
                  <span className="text-xs text-muted-foreground">{p.unit}</span>
                </div>
              </div>
            ))}
          </div>
          {products.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum produto ativo para contar.
            </p>
          )}
          <Button
            type="button"
            className="w-full"
            disabled={submitting || submitBlocked}
            onClick={() => void submit()}
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Enviando…
              </>
            ) : (
              "Enviar contagem"
            )}
          </Button>
        </CardContent>
      </Card>
    </PublicPageShell>
  );
}
