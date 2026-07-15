import { PageHeader } from "@/components/PageHeader";
import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCompany } from "@/contexts/CompanyContext";
import {
  buildChildrenMap,
  categoryPathLabel,
  isLeafCategory,
} from "@/lib/companyCategoryLabels";
import { canOwnerAccess } from "@/lib/roles";
import { supabase } from "@/lib/supabase";
import type { CompanyCategory } from "@/types/category";
import type { RevenueTaxType } from "@/types/revenue";
import type { CompanyRevenueCategoryTaxSetting } from "@/types/revenueCategoryTax";
import { Loader2, Percent } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type DraftRow = { tax_type: RevenueTaxType; tax_value: string };

export function ConfiguracoesImpostosReceita() {
  const { currentCompany, currentRole } = useCompany();
  const isOwner = currentRole ? canOwnerAccess(currentRole) : false;
  const companyId = currentCompany?.id;

  const [categories, setCategories] = useState<CompanyCategory[]>([]);
  const [savedSettings, setSavedSettings] = useState<
    CompanyRevenueCategoryTaxSetting[]
  >([]);
  const [draft, setDraft] = useState<Record<string, DraftRow>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const childrenMap = useMemo(() => buildChildrenMap(categories), [categories]);

  const categoriesById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );

  const revenueLeaves = useMemo(() => {
    return categories
      .filter(
        (c) =>
          c.natureza === "RECEITA" &&
          c.ativo !== false &&
          isLeafCategory(c.id, childrenMap) &&
          c.papel_receita_dre !== "DEDUCAO",
      )
      .sort((a, b) =>
        categoryPathLabel(a.id, categoriesById).localeCompare(
          categoryPathLabel(b.id, categoriesById),
          "pt-BR",
        ),
      );
  }, [categories, childrenMap, categoriesById]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const [catRes, taxRes] = await Promise.all([
      supabase
        .from("company_categories")
        .select("*")
        .eq("company_id", companyId)
        .order("ordem", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("company_revenue_category_tax_settings")
        .select("*")
        .eq("company_id", companyId),
    ]);
    setLoading(false);
    if (catRes.error) {
      console.error(catRes.error);
      toast.error("Não foi possível carregar as categorias.");
      setCategories([]);
      return;
    }
    const cats = (catRes.data ?? []) as CompanyCategory[];
    setCategories(cats);
    if (taxRes.error) {
      console.error(taxRes.error);
      toast.error("Não foi possível carregar as taxas salvas.");
      setSavedSettings([]);
      return;
    }
    setSavedSettings((taxRes.data ?? []) as CompanyRevenueCategoryTaxSetting[]);
  }, [companyId]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  useEffect(() => {
    const taxByCat = new Map(savedSettings.map((s) => [s.category_id, s]));
    const next: Record<string, DraftRow> = {};
    for (const leaf of revenueLeaves) {
      const s = taxByCat.get(leaf.id);
      next[leaf.id] = {
        tax_type: (s?.tax_type as RevenueTaxType) ?? "percentage",
        tax_value: s != null ? String(s.tax_value) : "0",
      };
    }
    setDraft(next);
  }, [revenueLeaves, savedSettings]);

  const updateDraft = (categoryId: string, patch: Partial<DraftRow>) => {
    setDraft((d) => ({
      ...d,
      [categoryId]: { ...d[categoryId], ...patch },
    }));
  };

  const handleSave = async () => {
    if (!companyId || !isOwner) return;
    setSaving(true);
    const rows: CompanyRevenueCategoryTaxSetting[] = revenueLeaves.map(
      (leaf) => {
        const row = draft[leaf.id] ?? {
          tax_type: "percentage" as const,
          tax_value: "0",
        };
        const n = parseFloat(String(row.tax_value).replace(",", ".")) || 0;
        return {
          company_id: companyId,
          category_id: leaf.id,
          tax_type: row.tax_type,
          tax_value: n,
        };
      },
    );

    const { error } = await supabase
      .from("company_revenue_category_tax_settings")
      .upsert(rows, { onConflict: "company_id,category_id" });

    setSaving(false);
    if (error) {
      console.error(error);
      toast.error(error.message ?? "Não foi possível salvar.");
      return;
    }
    toast.success("Taxas por categoria salvas.");
    await load();
  };

  if (!isOwner) {
    return (
      <PageShell>
        <Card>
          <CardHeader>
            <CardTitle>Impostos na receita</CardTitle>
            <CardDescription>
              Apenas o proprietário pode alterar estas configurações.
            </CardDescription>
          </CardHeader>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell className="space-y-8">
      <PageHeader
        icon={Percent}
        title="Impostos na receita"
        description="Defina o tipo e o valor da taxa ou imposto incidente sobre o valor bruto de cada categoria de receita (folha). Os lançamentos de receita usam automaticamente a taxa da categoria escolhida."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Taxa por categoria</CardTitle>
          <CardDescription>
            Percentual sobre o bruto ou valor fixo em reais (limitado ao valor
            bruto do lançamento). Categorias sem linha aqui usam 0% até você
            salvar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando…
            </div>
          ) : revenueLeaves.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Cadastre folhas de receita em Configurações › Categorias para
              poder definir taxas.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                      <th className="p-3 font-medium">Categoria</th>
                      <th className="p-3 font-medium w-[140px]">Tipo</th>
                      <th className="p-3 font-medium w-[120px]">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {revenueLeaves.map((leaf) => {
                      const row = draft[leaf.id] ?? {
                        tax_type: "percentage" as RevenueTaxType,
                        tax_value: "0",
                      };
                      const path = categoryPathLabel(leaf.id, categoriesById);
                      const tipo =
                        leaf.tipo === "OPERACIONAL"
                          ? "Operacional"
                          : "Não operacional";
                      return (
                        <tr key={leaf.id} className="border-b border-border/60">
                          <td className="p-3 align-top">
                            <p className="font-medium text-foreground">
                              {path}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {tipo}
                            </p>
                          </td>
                          <td className="p-3 align-top">
                            <Select
                              value={row.tax_type}
                              onValueChange={(v) =>
                                updateDraft(leaf.id, {
                                  tax_type: v as RevenueTaxType,
                                })
                              }
                            >
                              <SelectTrigger className="h-9">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="percentage">
                                  Percentual (%)
                                </SelectItem>
                                <SelectItem value="currency">
                                  Valor (R$)
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="p-3 align-top">
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              className="h-9 tabular-nums"
                              value={row.tax_value}
                              onChange={(e) =>
                                updateDraft(leaf.id, {
                                  tax_value: e.target.value,
                                })
                              }
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving || loading}
                >
                  {saving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Salvando…
                    </>
                  ) : (
                    "Salvar alterações"
                  )}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
