import { Input } from "@/components/ui/input";
import {
  SEARCH_SELECT_WIDE_POPOVER_CLASS,
  SearchSelect,
} from "@/components/ui/search-select";
import { matchProductByTypedName } from "@/lib/outputProductDraft";
import {
  fetchSaleFamilyCandidates,
  type SaleFamilyProductOption,
} from "@/lib/productSaleFamily";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const CREATE_VALUE = "__create_sale_family__";

export function SaleFamilyDestinationFields({
  companyId,
  excludeProductId,
  familyId,
  newFamilyName,
  onFamilyIdChange,
  onNewFamilyNameChange,
  disabled,
}: {
  companyId: string;
  excludeProductId: string;
  familyId: string;
  newFamilyName: string;
  onFamilyIdChange: (familyId: string) => void;
  onNewFamilyNameChange: (name: string) => void;
  disabled?: boolean;
}) {
  const [families, setFamilies] = useState<SaleFamilyProductOption[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetchSaleFamilyCandidates(companyId, [])
      .then((rows) => {
        if (cancelled) return;
        setFamilies(
          rows.filter(
            (row) =>
              row.id !== excludeProductId &&
              row.stock_control_type !== "INTERMEDIATE",
          ),
        );
      })
      .catch((e) => {
        if (!cancelled) {
          toast.error(
            e instanceof Error
              ? e.message
              : "Não foi possível listar agrupamentos.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, excludeProductId]);

  const canCreateFromSearch = useMemo(() => {
    const q = search.trim();
    if (!q) return false;
    return !matchProductByTypedName(families, q);
  }, [families, search]);

  const selectValue = familyId || (newFamilyName ? CREATE_VALUE : "");

  return (
    <div className="space-y-3">
      <SearchSelect
        value={selectValue}
        onValueChange={(value) => {
          if (value === CREATE_VALUE) {
            onFamilyIdChange("");
            onNewFamilyNameChange(search.trim());
            return;
          }
          onFamilyIdChange(value);
          onNewFamilyNameChange("");
        }}
        options={families.map((row) => ({
          value: row.id,
          label: row.name,
          description:
            row.stock_control_type === "SALE_FAMILY"
              ? row.sku
                ? `Agrupamento · SKU ${row.sku}`
                : "Agrupamento"
              : row.sku
                ? `SKU ${row.sku} · vira agrupamento ao ligar`
                : "Vira agrupamento ao ligar",
          keywords: row.sku ?? "",
        }))}
        trailingOptions={
          canCreateFromSearch
            ? [
                {
                  value: CREATE_VALUE,
                  label: `Cadastrar «${search.trim()}» como agrupamento`,
                  description: "Nome do cardápio, sem estoque",
                  accent: true,
                },
              ]
            : newFamilyName
              ? [
                  {
                    value: CREATE_VALUE,
                    label: `Novo agrupamento: ${newFamilyName}`,
                    description: "Será cadastrado ao ligar",
                    accent: true,
                  },
                ]
              : []
        }
        placeholder="Escolher agrupamento"
        searchPlaceholder="Buscar agrupamento…"
        emptyMessage="Nenhum cadastro com esse nome. Cadastre abaixo."
        disabled={disabled}
        triggerClassName="h-auto min-h-10 bg-background px-3 py-2 text-left"
        contentClassName={SEARCH_SELECT_WIDE_POPOVER_CLASS}
        onSearchChange={setSearch}
      />
      <div className="space-y-1.5">
        <p className="text-xs font-medium">Ou cadastre um agrupamento novo</p>
        <Input
          value={newFamilyName}
          onChange={(e) => {
            onNewFamilyNameChange(e.target.value);
            if (e.target.value.trim()) onFamilyIdChange("");
          }}
          placeholder="Ex.: Bolinho"
          disabled={disabled}
        />
        <p className="text-xs text-muted-foreground">
          Se o nome ainda não existe, cria o agrupamento (cardápio sem estoque)
          e liga este item como variante. Nome igual a um cadastro existente
          usa esse cadastro.
        </p>
      </div>
    </div>
  );
}
