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
import { Label } from "@/components/ui/label";
import {
  productSearchOption,
  SearchSelect,
} from "@/components/ui/search-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useCompany } from "@/contexts/CompanyContext";
import { canonicalProductName } from "@/lib/productImport/canonicalName";
import {
  clampThresholds,
  DEFAULT_IMPORT_MATCH_THRESHOLDS,
} from "@/lib/productImport/matchConfig";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Loader2, PackageSearch, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

const UNIT_CODES = [
  "UND",
  "KG",
  "G",
  "L",
  "ML",
  "CX",
  "SACHE",
  "UNKN",
] as const;

type ProductOption = { id: string; name: string; unit: string };

type EquivalenceRow = {
  id: string;
  company_id: string;
  source_canonical_name: string;
  source_unit_normalized: string;
  product_id: string;
  dest_unit_normalized: string | null;
  conversion_factor: number | null;
  requires_confirmation: boolean;
  invoice_ncm: string | null;
  invoice_ean: string | null;
  updated_at: string;
  products: { name: string; unit: string } | null;
};

export function ConfiguracoesImportacaoProdutos() {
  const { currentCompany } = useCompany();
  const companyId = currentCompany?.id;

  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingEquiv, setSavingEquiv] = useState(false);

  const [autoMatch, setAutoMatch] = useState<number>(
    DEFAULT_IMPORT_MATCH_THRESHOLDS.autoMatchMinScore,
  );
  const [confirmMin, setConfirmMin] = useState<number>(
    DEFAULT_IMPORT_MATCH_THRESHOLDS.confirmMinScore,
  );
  /** True quando já existe linha em `company_product_import_settings`. */
  const [hasSavedThresholds, setHasSavedThresholds] = useState(false);
  const [autoApplyGlobalMassVol, setAutoApplyGlobalMassVol] = useState(false);

  const [equivRows, setEquivRows] = useState<EquivalenceRow[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);

  const [newCanon, setNewCanon] = useState("");
  const [newUnit, setNewUnit] = useState<string>("KG");
  const [newProductId, setNewProductId] = useState<string>("");
  const [newDestUnit, setNewDestUnit] = useState("");
  const [newFactor, setNewFactor] = useState("");
  const [newRequiresConfirm, setNewRequiresConfirm] = useState(false);
  const [newNcm, setNewNcm] = useState("");
  const [newEan, setNewEan] = useState("");

  const loadProducts = useCallback(async (cid: string) => {
    const { data, error } = await supabase
      .from("products")
      .select("id, name, unit")
      .eq("company_id", cid)
      .eq("is_active", true)
      .order("name", { ascending: true })
      .limit(2000);
    if (error) {
      console.error(error);
      return;
    }
    setProducts((data ?? []) as ProductOption[]);
  }, []);

  const loadAll = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const [setRes, eqRes] = await Promise.all([
      supabase
        .from("company_product_import_settings")
        .select(
          "auto_match_min_score, confirm_min_score, auto_apply_global_mass_volume",
        )
        .eq("company_id", companyId)
        .maybeSingle(),
      supabase
        .from("product_import_equivalences")
        .select(
          `
          id,
          company_id,
          source_canonical_name,
          source_unit_normalized,
          product_id,
          dest_unit_normalized,
          conversion_factor,
          requires_confirmation,
          invoice_ncm,
          invoice_ean,
          updated_at,
          products ( name, unit )
        `,
        )
        .eq("company_id", companyId)
        .order("source_canonical_name", { ascending: true }),
    ]);

    if (setRes.error) {
      console.error(setRes.error);
      toast.error("Não foi possível carregar os limiares.");
    } else if (setRes.data) {
      setAutoMatch(setRes.data.auto_match_min_score);
      setConfirmMin(setRes.data.confirm_min_score);
      setAutoApplyGlobalMassVol(
        !!(setRes.data as { auto_apply_global_mass_volume?: boolean })
          .auto_apply_global_mass_volume,
      );
      setHasSavedThresholds(true);
    } else {
      setAutoMatch(DEFAULT_IMPORT_MATCH_THRESHOLDS.autoMatchMinScore);
      setConfirmMin(DEFAULT_IMPORT_MATCH_THRESHOLDS.confirmMinScore);
      setAutoApplyGlobalMassVol(false);
      setHasSavedThresholds(false);
    }

    if (eqRes.error) {
      console.error(eqRes.error);
      toast.error("Não foi possível carregar equivalências.");
    } else {
      const raw = eqRes.data ?? [];
      setEquivRows(
        raw.map((row) => {
          const p = row.products;
          const product =
            Array.isArray(p) ? p[0] ?? null : (p as { name: string; unit: string } | null);
          return {
            ...row,
            products: product,
          };
        }) as EquivalenceRow[],
      );
    }

    await loadProducts(companyId);
    setLoading(false);
  }, [companyId, loadProducts]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleSaveSettings = async () => {
    if (!companyId) return;
    const t = clampThresholds({
      autoMatchMinScore: autoMatch,
      confirmMinScore: confirmMin,
    });
    setAutoMatch(t.autoMatchMinScore);
    setConfirmMin(t.confirmMinScore);

    setSavingSettings(true);
    const { error } = await supabase.from("company_product_import_settings").upsert(
      {
        company_id: companyId,
        auto_match_min_score: t.autoMatchMinScore,
        confirm_min_score: t.confirmMinScore,
        auto_apply_global_mass_volume: autoApplyGlobalMassVol,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "company_id" },
    );
    setSavingSettings(false);
    if (error) {
      toast.error(error.message ?? "Erro ao salvar limiares.");
      return;
    }
    setHasSavedThresholds(true);
    toast.success("Limiares de importação salvos.");
  };

  const handleAddEquivalence = async () => {
    if (!companyId || !newProductId) {
      toast.error("Selecione o produto do cadastro.");
      return;
    }
    const canonKey = canonicalProductName(newCanon);
    if (!canonKey) {
      toast.error(
        "Informe um texto de descrição válido — o nome canônico não pode ficar vazio.",
      );
      return;
    }

    setSavingEquiv(true);
    const payload = {
      company_id: companyId,
      source_canonical_name: canonKey,
      source_unit_normalized: newUnit,
      product_id: newProductId,
      dest_unit_normalized: newDestUnit.trim() || null,
      conversion_factor:
        newFactor.trim() === ""
          ? null
          : Number(newFactor.replace(",", ".")),
      requires_confirmation: newRequiresConfirm,
      invoice_ncm: newNcm.trim() || null,
      invoice_ean: newEan.replace(/\D/g, "") || null,
      updated_at: new Date().toISOString(),
    };

    if (
      payload.conversion_factor != null &&
      (!Number.isFinite(payload.conversion_factor) ||
        payload.conversion_factor <= 0)
    ) {
      setSavingEquiv(false);
      toast.error("Fator de conversão inválido.");
      return;
    }

    const { error } = await supabase
      .from("product_import_equivalences")
      .upsert(payload, {
        onConflict: "company_id,source_canonical_name,source_unit_normalized",
      });

    setSavingEquiv(false);
    if (error) {
      if (error.code === "23505" || error.message.includes("duplicate")) {
        toast.error(
          "Já existe equivalência para este nome canônico e unidade. Exclua a linha ou altere a chave.",
        );
      } else {
        toast.error(error.message ?? "Erro ao salvar equivalência.");
      }
      return;
    }

    toast.success("Equivalência salva.");
    setNewCanon("");
    setNewDestUnit("");
    setNewFactor("");
    setNewNcm("");
    setNewEan("");
    setNewRequiresConfirm(false);
    void loadAll();
  };

  const handleDeleteEquivalence = async (id: string) => {
    const { error } = await supabase
      .from("product_import_equivalences")
      .delete()
      .eq("id", id);
    if (error) {
      toast.error(error.message ?? "Erro ao excluir.");
      return;
    }
    toast.success("Equivalência removida.");
    setEquivRows((prev) => prev.filter((r) => r.id !== id));
  };

  if (!companyId) {
    return (
      <PageShell>
        <p className="text-sm text-muted-foreground">Selecione uma empresa.</p>
      </PageShell>
    );
  }

  return (
    <PageShell className="space-y-8">
      <PageHeader
        icon={PackageSearch}
        title="Importação de produtos (nota / WhatsApp)"
        description="Ajuste os limiares de correspondência automática e cadastre equivalências fixas entre o texto da nota e o produto no Faro."
      />

      <Card>
        <CardHeader>
          <CardTitle>Limiares de correspondência</CardTitle>
          <CardDescription>
            Valores de 0 a 100. Vínculo automático exige score ≥ limiar alto{" "}
            <strong>e</strong> unidade compatível com o cadastro. Entre o limiar
            intermediário e o alto, o sistema pede confirmação. Abaixo do
            intermediário, trata como produto novo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 max-w-md">
                <div className="space-y-2">
                  <Label htmlFor="autoMatch">Mínimo para vínculo automático</Label>
                  <Input
                    id="autoMatch"
                    type="number"
                    min={0}
                    max={100}
                    value={autoMatch}
                    onChange={(e) => setAutoMatch(Number(e.target.value))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmMin">Mínimo para sugerir confirmação</Label>
                  <Input
                    id="confirmMin"
                    type="number"
                    min={0}
                    max={100}
                    value={confirmMin}
                    onChange={(e) => setConfirmMin(Number(e.target.value))}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 pt-2 max-w-md">
                <Switch
                  id="autoMassVol"
                  checked={autoApplyGlobalMassVol}
                  onCheckedChange={setAutoApplyGlobalMassVol}
                />
                <Label htmlFor="autoMassVol" className="cursor-pointer text-sm leading-snug">
                  Aplicar conversão automática global (gramas ↔ kg, ml ↔ litro) quando o
                  cadastro estiver na unidade base da família
                </Label>
              </div>
            </>
          )}
          <Button
            type="button"
            onClick={() => void handleSaveSettings()}
            disabled={savingSettings || loading}
          >
            {savingSettings ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Salvar limiares"
            )}
          </Button>
          {!hasSavedThresholds && !loading ? (
            <p className="text-xs text-muted-foreground">
              Nenhum registro salvo ainda — os padrões ({DEFAULT_IMPORT_MATCH_THRESHOLDS.autoMatchMinScore} / {DEFAULT_IMPORT_MATCH_THRESHOLDS.confirmMinScore}) valem até você salvar.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Equivalências manuais</CardTitle>
          <CardDescription>
            Quando a nota trouxer sempre a mesma descrição e unidade, você pode
            fixar o produto do cadastro. O{" "}
            <strong>nome canônico</strong> deve seguir a mesma normalização do
            sistema (sem acentuação extra, tokens limpos). Use o preview abaixo
            ao digitar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Preview canônico: </span>
            <code className="rounded bg-background px-1.5 py-0.5 text-foreground">
              {newCanon.trim() ? canonicalProductName(newCanon) : "—"}
            </code>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2 sm:col-span-2">
              <Label>Nome na nota (para gerar canônico)</Label>
              <Input
                value={newCanon}
                onChange={(e) => setNewCanon(e.target.value)}
                placeholder='Ex.: "Maionese Sachê 500g"'
              />
            </div>
            <div className="space-y-2">
              <Label>Unidade na nota (código)</Label>
              <Select value={newUnit} onValueChange={setNewUnit}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNIT_CODES.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Produto no Faro</Label>
              <SearchSelect
                value={newProductId}
                onValueChange={setNewProductId}
                options={products.map((p) =>
                  productSearchOption({
                    id: p.id,
                    name: p.name,
                    unit: p.unit,
                  }),
                )}
                placeholder="Selecione o produto"
                searchPlaceholder="Buscar produto…"
                emptyMessage="Nenhum produto encontrado."
                listMaxHeightClassName="max-h-72"
              />
            </div>
            <div className="space-y-2">
              <Label>Unidade destino (opcional)</Label>
              <Input
                value={newDestUnit}
                onChange={(e) => setNewDestUnit(e.target.value)}
                placeholder="Ex.: kg"
              />
            </div>
            <div className="space-y-2">
              <Label>Fator de conversão (opcional)</Label>
              <Input
                value={newFactor}
                onChange={(e) => setNewFactor(e.target.value)}
                placeholder="Ex.: 1 ou 1000"
              />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Switch
                id="reqConf"
                checked={newRequiresConfirm}
                onCheckedChange={setNewRequiresConfirm}
              />
              <Label htmlFor="reqConf" className="cursor-pointer">
                Sempre pedir confirmação ao usar esta regra
              </Label>
            </div>
            <div className="space-y-2">
              <Label>NCM na linha (opcional)</Label>
              <Input value={newNcm} onChange={(e) => setNewNcm(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>EAN (opcional)</Label>
              <Input value={newEan} onChange={(e) => setNewEan(e.target.value)} />
            </div>
          </div>

          <Button
            type="button"
            onClick={() => void handleAddEquivalence()}
            disabled={savingEquiv || loading}
            className="gap-2"
          >
            {savingEquiv ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Salvar equivalência
          </Button>

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th className="p-3 font-medium">Canônico</th>
                  <th className="p-3 font-medium">Unid.</th>
                  <th className="p-3 font-medium">Produto</th>
                  <th className="p-3 font-medium">Confirma?</th>
                  <th className="w-[72px] p-3" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-muted-foreground">
                      Carregando…
                    </td>
                  </tr>
                ) : equivRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-muted-foreground">
                      Nenhuma equivalência cadastrada.
                    </td>
                  </tr>
                ) : (
                  equivRows.map((r) => (
                    <tr key={r.id} className="border-b border-border/80">
                      <td className="p-3 font-medium">{r.source_canonical_name}</td>
                      <td className="p-3">{r.source_unit_normalized}</td>
                      <td className="p-3">
                        {r.products?.name ?? "—"}{" "}
                        <span className="text-muted-foreground text-xs">
                          ({r.products?.unit ?? "?"})
                        </span>
                      </td>
                      <td className="p-3">{r.requires_confirmation ? "Sim" : "Não"}</td>
                      <td className="p-3">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className={cn("text-destructive hover:text-destructive")}
                          title="Excluir"
                          onClick={() => void handleDeleteEquivalence(r.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </PageShell>
  );
}
