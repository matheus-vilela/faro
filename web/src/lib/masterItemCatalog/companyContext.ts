import type { OperationalItemType } from "@/lib/itemClassification/operationalItemTypes";

export type CompanyMasterCatalogOverrideInput = {
  id: string;
  custom_name: string | null;
  custom_alias: string | null;
  override_operational_type: OperationalItemType | null;
  master_external_key: string | null;
  score_adjustment: number | null;
  active: boolean;
};

export type LearningTalliesByNormalizedInput = Map<
  string,
  Partial<Record<OperationalItemType, number>>
>;
