/** Evento disparado após persistir `company_integrations` (ex.: ativar/desativar EPOC). */
export const COMPANY_INTEGRATION_UPDATED_EVENT = "faro:company-integration-updated";

export type CompanyIntegrationUpdatedDetail = {
  companyId: string;
  provider: string;
  enabled: boolean;
};

export function emitCompanyIntegrationUpdated(
  detail: CompanyIntegrationUpdatedDetail,
) {
  window.dispatchEvent(
    new CustomEvent(COMPANY_INTEGRATION_UPDATED_EVENT, { detail }),
  );
}
