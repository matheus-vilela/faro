import { SaleFamilyLinkSheet } from "@/components/products/SaleFamilyLinkSheet";
import type { EpocEstoqueSaidaItem } from "@/services/epocEstoqueExportService";

export function EpocSaleFamilyLinkSheet({
  open,
  onOpenChange,
  companyId,
  item,
  saleNames,
  onLinked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  item: EpocEstoqueSaidaItem | null;
  saleNames: string[];
  onLinked: () => void;
}) {
  return (
    <SaleFamilyLinkSheet
      open={open}
      onOpenChange={onOpenChange}
      companyId={companyId}
      saleNames={saleNames}
      variantName={item?.nome}
      variantSku={item?.sku}
      variantUnit={item?.qtde_unidade || "un"}
      onLinked={onLinked}
    />
  );
}
