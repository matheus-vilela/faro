export { mapMasterConceptToOperational } from "@/lib/masterItemCatalog/mapMasterToOperational";
export {
  applyMasterCatalogToScores,
  buildMasterImportReasons,
  resolveMasterItemCatalog,
  type ApplyMasterCatalogContext,
  type MasterImportLineLearningHint,
  type ResolveMasterInput,
} from "@/lib/masterItemCatalog/resolveMasterItemCatalog";
export type { CompanyMasterCatalogOverrideInput, LearningTalliesByNormalizedInput } from "@/lib/masterItemCatalog/companyContext";
export { nameOrAliasMatchesBlob, masterCatalogNorm } from "@/lib/masterItemCatalog/matchText";
export { MASTER_ITEM_DEFINITIONS } from "@/lib/masterItemCatalog/seedRegistry";
export type {
  MasterCatalogConceptType,
  MasterCatalogMatch,
  MasterItemDefinition,
} from "@/lib/masterItemCatalog/types";
