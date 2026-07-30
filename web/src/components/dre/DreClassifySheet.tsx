import { BoletoCategoryPicker } from "@/components/BoletoCategoryPicker";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { assignBoletoCategories } from "@/lib/dre/assignBoletoCategories";
import type { CompanyCategory } from "@/types/category";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export function DreClassifySheet({
  open,
  onOpenChange,
  companyId,
  boletoIds,
  categories,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  boletoIds: string[];
  categories: CompanyCategory[];
  onDone: () => void | Promise<void>;
}) {
  const [categoryId, setCategoryId] = useState("");
  const [natureza, setNatureza] = useState<"DESPESA" | "RECEITA">("DESPESA");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!categoryId) {
      toast.error("Selecione uma categoria do plano.");
      return;
    }
    setSaving(true);
    try {
      await assignBoletoCategories({
        companyId,
        boletoIds,
        categoryId,
      });
      toast.success(
        `${boletoIds.length} lançamento(s) classificado(s).`,
      );
      setCategoryId("");
      onOpenChange(false);
      await onDone();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Não foi possível classificar.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Classificar lançamentos</SheetTitle>
          <SheetDescription>
            Atribua uma categoria do plano a {boletoIds.length} lançamento(s)
            sem classificação. Eles passam a entrar no DRE.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-4 py-4">
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={natureza === "DESPESA" ? "default" : "outline"}
              onClick={() => {
                setNatureza("DESPESA");
                setCategoryId("");
              }}
            >
              Despesa
            </Button>
            <Button
              type="button"
              size="sm"
              variant={natureza === "RECEITA" ? "default" : "outline"}
              onClick={() => {
                setNatureza("RECEITA");
                setCategoryId("");
              }}
            >
              Receita
            </Button>
          </div>

          <div className="space-y-2">
            <Label>Categoria</Label>
            <BoletoCategoryPicker
              companyId={companyId}
              value={categoryId}
              onValueChange={setCategoryId}
              categories={categories}
              loading={false}
              onReload={async () => {}}
              categoryNatureza={natureza}
            />
          </div>
        </div>

        <SheetFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button type="button" disabled={saving || !categoryId} onClick={() => void handleSave()}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Salvando…
              </>
            ) : (
              "Classificar"
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
