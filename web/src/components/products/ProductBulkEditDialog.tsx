import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProductBulkEditPreviewTable } from "@/components/products/ProductBulkEditPreviewTable";
import {
  applyProductBulkEdit,
  previewProductBulkEdit,
} from "@/lib/productBulkEdit";
import {
  BULK_EDIT_FIELDS,
  bulkEditFieldsByGroup,
  buildBulkEditChangesPayload,
  operationalTypeOptions,
} from "@/lib/productBulkEditFields";
import type { CompanyProductCategory } from "@/types/companyProductCategory";
import type { BulkEditFieldKey } from "@/types/productBulkEdit";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type WizardStep = "field" | "value" | "preview";

type CmvCategoryOption = { id: string; name: string };

export function ProductBulkEditDialog({
  open,
  onOpenChange,
  companyId,
  productIds,
  companyProductCategories,
  cmvCategories,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  productIds: string[];
  companyProductCategories: CompanyProductCategory[];
  cmvCategories: CmvCategoryOption[];
  onApplied?: (operationId: string, updatedCount: number) => void;
}) {
  const [step, setStep] = useState<WizardStep>("field");
  const [fieldKey, setFieldKey] = useState<BulkEditFieldKey | "">("");
  const [textValue, setTextValue] = useState("");
  const [boolValue, setBoolValue] = useState(true);
  const [categoryMode, setCategoryMode] = useState<"replace" | "add" | "remove">(
    "replace",
  );
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [operationalType, setOperationalType] = useState("INSUMO");
  const [cmvCategoryId, setCmvCategoryId] = useState<string>("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  const [previewItems, setPreviewItems] = useState<
    import("@/types/productBulkEdit").BulkEditPreviewItem[]
  >([]);
  const [previewTotal, setPreviewTotal] = useState(0);
  const [previewTruncated, setPreviewTruncated] = useState(false);

  const fieldMeta = useMemo(
    () => BULK_EDIT_FIELDS.find((f) => f.key === fieldKey),
    [fieldKey],
  );

  const fieldsByGroup = useMemo(() => bulkEditFieldsByGroup(), []);

  const productCategoryNameById = useMemo(
    () => Object.fromEntries(companyProductCategories.map((c) => [c.id, c.name])),
    [companyProductCategories],
  );

  const cmvCategoryNameById = useMemo(
    () => Object.fromEntries(cmvCategories.map((c) => [c.id, c.name])),
    [cmvCategories],
  );

  const resetForm = useCallback(() => {
    setStep("field");
    setFieldKey("");
    setTextValue("");
    setBoolValue(true);
    setCategoryMode("replace");
    setCategoryIds([]);
    setOperationalType("INSUMO");
    setCmvCategoryId("");
    setPreviewItems([]);
    setPreviewTotal(0);
    setPreviewTruncated(false);
  }, []);

  useEffect(() => {
    if (!open) resetForm();
  }, [open, resetForm]);

  const changesPayload = useMemo(() => {
    if (!fieldKey) return {};
    return buildBulkEditChangesPayload(fieldKey, {
      textValue,
      boolValue,
      categoryMode,
      categoryIds,
      operationalType,
      cmvCategoryId: cmvCategoryId || null,
    });
  }, [
    fieldKey,
    textValue,
    boolValue,
    categoryMode,
    categoryIds,
    operationalType,
    cmvCategoryId,
  ]);

  const loadPreview = async () => {
    if (!fieldKey) return;
    setPreviewLoading(true);
    const result = await previewProductBulkEdit(
      companyId,
      productIds,
      fieldKey,
      changesPayload,
    );
    setPreviewLoading(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setPreviewItems(result.items);
    setPreviewTotal(result.total_count);
    setPreviewTruncated(result.truncated);
    setStep("preview");
  };

  const handleApply = async () => {
    if (!fieldKey) return;
    setApplyLoading(true);
    const result = await applyProductBulkEdit(
      companyId,
      productIds,
      fieldKey,
      changesPayload,
    );
    setApplyLoading(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(
      `Alteração aplicada em ${result.updated_count} produto(s). Você pode desfazer em até 24 horas.`,
    );
    onApplied?.(result.operation_id, result.updated_count);
    onOpenChange(false);
  };

  const toggleCategory = (id: string) => {
    setCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const valueStepValid =
    fieldMeta?.inputType === "categories"
      ? categoryIds.length > 0 || categoryMode === "remove"
      : fieldMeta?.inputType === "cmv_category" ||
          fieldMeta?.inputType === "boolean" ||
          fieldMeta?.inputType === "operational_type" ||
          textValue.trim() !== "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar em lote</DialogTitle>
          <DialogDescription>
            {productIds.length} produto(s) selecionado(s). Escolha o campo e o
            novo valor comum a todos.
          </DialogDescription>
        </DialogHeader>

        {step === "field" ? (
          <div className="space-y-4">
            {[...fieldsByGroup.entries()].map(([group, fields]) => (
              <div key={group} className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group}
                </p>
                <div className="grid gap-1.5">
                  {fields.map((f) => (
                    <Button
                      key={f.key}
                      type="button"
                      variant={fieldKey === f.key ? "default" : "outline"}
                      className="h-auto justify-start py-2 text-left"
                      onClick={() => setFieldKey(f.key)}
                    >
                      <span className="font-medium">{f.label}</span>
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {step === "value" && fieldMeta ? (
          <div className="space-y-4">
            <p className="text-sm font-medium">{fieldMeta.label}</p>
            {fieldMeta.inputType === "text" ? (
              <Input
                value={textValue}
                onChange={(e) => setTextValue(e.target.value)}
                placeholder={fieldMeta.placeholder}
              />
            ) : null}
            {fieldMeta.inputType === "boolean" ? (
              <Select
                value={boolValue ? "true" : "false"}
                onValueChange={(v) => setBoolValue(v === "true")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">Sim</SelectItem>
                  <SelectItem value="false">Não</SelectItem>
                </SelectContent>
              </Select>
            ) : null}
            {fieldMeta.inputType === "operational_type" ? (
              <Select value={operationalType} onValueChange={setOperationalType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {operationalTypeOptions().map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            {fieldMeta.inputType === "cmv_category" ? (
              <Select
                value={cmvCategoryId || "__none__"}
                onValueChange={(v) =>
                  setCmvCategoryId(v === "__none__" ? "" : v)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Nenhuma</SelectItem>
                  {cmvCategories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            {fieldMeta.inputType === "categories" ? (
              <div className="space-y-3">
                <Select
                  value={categoryMode}
                  onValueChange={(v) =>
                    setCategoryMode(v as "replace" | "add" | "remove")
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="replace">Substituir categorias</SelectItem>
                    <SelectItem value="add">Adicionar categorias</SelectItem>
                    <SelectItem value="remove">Remover categorias</SelectItem>
                  </SelectContent>
                </Select>
                <div className="max-h-40 space-y-2 overflow-y-auto rounded-md border p-2">
                  {companyProductCategories.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Nenhuma categoria cadastrada.
                    </p>
                  ) : (
                    companyProductCategories.map((c) => (
                      <label
                        key={c.id}
                        className="flex cursor-pointer items-center gap-2 text-sm"
                      >
                        <Checkbox
                          checked={categoryIds.includes(c.id)}
                          onCheckedChange={() => toggleCategory(c.id)}
                        />
                        {c.name}
                      </label>
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === "preview" && fieldKey ? (
          <ProductBulkEditPreviewTable
            items={previewItems}
            totalCount={previewTotal}
            truncated={previewTruncated}
            fieldKey={fieldKey}
            productCategoryNames={productCategoryNameById}
            cmvCategoryNames={cmvCategoryNameById}
          />
        ) : null}

        <DialogFooter className="gap-2 sm:gap-0">
          {step === "field" ? (
            <>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={!fieldKey}
                onClick={() => setStep("value")}
              >
                Continuar
              </Button>
            </>
          ) : null}
          {step === "value" ? (
            <>
              <Button type="button" variant="outline" onClick={() => setStep("field")}>
                Voltar
              </Button>
              <Button
                type="button"
                disabled={!valueStepValid || previewLoading}
                onClick={() => void loadPreview()}
              >
                {previewLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Pré-visualizar"
                )}
              </Button>
            </>
          ) : null}
          {step === "preview" ? (
            <>
              <Button type="button" variant="outline" onClick={() => setStep("value")}>
                Voltar
              </Button>
              <Button
                type="button"
                disabled={applyLoading}
                onClick={() => void handleApply()}
              >
                {applyLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Confirmar alteração"
                )}
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
