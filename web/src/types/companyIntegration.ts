export type IntegrationProvider = "epoc";

export type EpocAmbiente = "producao" | "homologacao";

/** Campos persistidos em company_integrations.settings para provider epoc */
export type EpocIntegrationSettings = {
  username: string;
  /** Senha da API/conta EPOC (armazenada no JSONB; tráfego HTTPS) */
  password?: string;
  /** URL base da API ou portal, ex.: https://api.epoc.exemplo.com */
  base_url?: string;
  /** Código da filial ou unidade no EPOC, se aplicável */
  codigo_filial?: string;
  ambiente?: EpocAmbiente;
};

export type CompanyIntegrationRow = {
  id: string;
  company_id: string;
  provider: IntegrationProvider;
  enabled: boolean;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
