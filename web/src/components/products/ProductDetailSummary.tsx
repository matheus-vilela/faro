import { ProductGroupingInfoCard } from "@/components/products/ProductGroupingInfoCard";
import { ProductIdentificationSummary } from "@/components/products/ProductIdentificationSummary";
import { ProductMergeAuditSection } from "@/components/products/ProductMergeAuditSection";
import { ProductRecipeLinksSection } from "@/components/products/ProductRecipeLinksSection";
import { ProductSetupCard } from "@/components/products/ProductSetupCard";
import { ProductStockLotsSection } from "@/components/products/ProductStockLotsSection";
import { ProductStockValueCard } from "@/components/products/ProductStockValueCard";
import { ProductUnitConversionsSection } from "@/components/products/ProductUnitConversionsSection";
import { PRODUCT_SHEET_SECTION } from "@/components/products/productSheetStyles";
import { type TechnicalSheetKind } from "@/lib/productIntermediate";
import { isPossibleGroupingProduct } from "@/lib/productSaleFamily";
import type { Product } from "@/types/product";
import type { ProductUnitConversionDraft } from "@/types/productUnitConversion";
import { useState } from "react";

export function ProductDetailSummary({
  product,
  companyId,
  operationalTypeLabel,
  composesCmv,
  formatCurrency,
  hasTechnicalSheet,
  lotsRefreshKey,
  conversions,
  conversionsLoading,
  conversionsSaving,
  onConversionsChange,
  onPromoteStockUnit,
  onOpenTechnicalSheet,
  onOpenMerge,
  onProductChanged,
}: {
  product: Product;
  companyId: string | undefined;
  operationalTypeLabel: string;
  composesCmv: boolean;
  formatCurrency: (value: number) => string;
  hasTechnicalSheet: boolean;
  lotsRefreshKey: number;
  conversions: ProductUnitConversionDraft[];
  conversionsLoading: boolean;
  conversionsSaving: boolean;
  onConversionsChange: (next: ProductUnitConversionDraft[]) => void;
  onPromoteStockUnit: (code: string) => void;
  onOpenTechnicalSheet: (kind: TechnicalSheetKind) => void;
  onOpenMerge: (partnerId?: string) => void;
  onProductChanged: () => void;
}) {
  const [groupingRefreshKey, setGroupingRefreshKey] = useState(0);
  const [conversionDialogOpen, setConversionDialogOpen] = useState(false);
  const [conversionPrefillUnit, setConversionPrefillUnit] = useState<
    string | null
  >(null);
  const refreshGrouping = () => {
    setGroupingRefreshKey((n) => n + 1);
    onProductChanged();
  };

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
        <ProductIdentificationSummary
          product={product}
          composesCmv={composesCmv}
          operationalTypeLabel={operationalTypeLabel}
        />
        <ProductStockValueCard
          product={product}
          formatCurrency={formatCurrency}
          conversions={conversions}
          conversionsLoading={conversionsLoading}
          onCreateConversion={(priceUnit) => {
            setConversionPrefillUnit(priceUnit);
            setConversionDialogOpen(true);
          }}
        />
      </div>

      {companyId ? (
        <ProductSetupCard
          companyId={companyId}
          productId={product.id}
          productName={product.name}
          stockControlType={product.stock_control_type}
          notSaleGrouping={product.not_sale_grouping}
          possibleGrouping={isPossibleGroupingProduct(product)}
          hasTechnicalSheet={hasTechnicalSheet}
          className={PRODUCT_SHEET_SECTION}
          onOpenTechnicalSheet={onOpenTechnicalSheet}
          onOpenMerge={onOpenMerge}
          onChanged={refreshGrouping}
        />
      ) : null}

      {companyId ? (
        <ProductGroupingInfoCard
          companyId={companyId}
          productId={product.id}
          refreshKey={groupingRefreshKey}
        />
      ) : null}

      <ProductStockLotsSection
        productId={product.id}
        unit={product.unit}
        currentStock={Number(product.current_quantity)}
        refreshKey={lotsRefreshKey}
        readOnly
      />

      {companyId ? (
        conversionsLoading && !conversionDialogOpen ? (
          <div className={PRODUCT_SHEET_SECTION}>
            <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
              Conversões de unidade
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Carregando conversões…
            </p>
          </div>
        ) : (
          <ProductUnitConversionsSection
            compact
            companyId={companyId}
            stockUnitCode={product.unit}
            value={conversions}
            onChange={onConversionsChange}
            onPromoteSecondaryToStockUnit={onPromoteStockUnit}
            disabled={conversionsSaving}
            sectionClassName={PRODUCT_SHEET_SECTION}
            addDialogOpen={conversionDialogOpen}
            onAddDialogOpenChange={(open) => {
              setConversionDialogOpen(open);
              if (!open) setConversionPrefillUnit(null);
            }}
            preferredSecondaryUnit={conversionPrefillUnit}
          />
        )
      ) : null}

      {companyId ? (
        <div className="flex flex-col items-stretch gap-4 md:flex-row">
          <ProductMergeAuditSection
            companyId={companyId}
            product={product}
            className={`${PRODUCT_SHEET_SECTION} min-w-0 md:flex-1`}
            onUndone={onProductChanged}
          />
          <ProductRecipeLinksSection
            companyId={companyId}
            productId={product.id}
            productName={product.name}
            className={`${PRODUCT_SHEET_SECTION} min-w-0 md:flex-1`}
            onChanged={onProductChanged}
          />
        </div>
      ) : null}
    </div>
  );
}
