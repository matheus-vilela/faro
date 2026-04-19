/** Status do assistente de configuração persistido em companies.setup */
export type CompanySetupStatus =
  | "not_started"
  | "in_progress"
  | "paused"
  | "completed";

/** Passos 1–6 do wizard */
export type SetupStepNumber = 1 | 2 | 3 | 4 | 5 | 6;

export type EmpresaMap = {
  nome_razao_social?: string;
  nome_fantasia?: string;
  cnpj_cpf?: string;
  inscricao_estadual?: string;
  regime_tributario?: number;
  email?: string;
  telefone?: string;
  photo_base64?: string;
};

export type EnderecoPrincipalMap = {
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  ibge_cidade?: string;
};

/** Alinhado ao schema pedido; valores opcionais até o usuário preencher */
export type FocusNfeMap = {
  modelo?: string;
  csc_nfce_producao?: string;
  id_token_nfce_producao?: string;
  csc_nfce_homologacao?: string;
  id_token_nfce_homologacao?: string;
  serie?: string;
  proximoNumeroNfce?: string;
  certificado_ativo?: boolean;
  certificado_validade?: string;
  token_homologacao?: string;
  token_producao?: string;
  id_empresa?: number;
};

export type CertificateUploadStatus =
  | "not_sent"
  | "uploaded"
  | "validating"
  | "valid"
  | "invalid";

export type SetupCertificateState = {
  status: CertificateUploadStatus;
  storage_path?: string;
  file_name?: string;
  error_message?: string;
  updated_at?: string;
};

export type XmlZipImportPhase =
  | "idle"
  | "uploading"
  | "parsing"
  | "preview"
  | "importing"
  | "done"
  | "error";

export type XmlZipFileLogEntry = {
  name: string;
  ok: boolean;
  message?: string;
};

export type SetupXmlZipImportState = {
  phase: XmlZipImportPhase;
  storage_path?: string;
  file_name?: string;
  error_message?: string;
  file_log: XmlZipFileLogEntry[];
  updated_at?: string;
};

export type EpocWizardMode = "undecided" | "no" | "credentials" | "excel";

export type SetupEpocState = {
  mode: EpocWizardMode;
  /** Rascunho local antes de gravar em company_integrations */
  username?: string;
  password?: string;
  base_url?: string;
  codigo_filial?: string;
  excel_storage_path?: string;
  updated_at?: string;
};

export type CompanySetupMap = {
  status: CompanySetupStatus;
  current_step: number;
  completed_steps: number[];
  skipped_steps: number[];
  progress_percent: number;
  started_at?: string;
  updated_at?: string;
  completed_at?: string;
  last_paused_at?: string;
  certificate?: SetupCertificateState;
  xml_zip_import?: SetupXmlZipImportState;
  epoc?: SetupEpocState;
};

export const REGIME_TRIBUTARIO_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "Simples Nacional" },
  { value: 2, label: "Regime Normal" },
  {
    value: 3,
    label: "Simples Nacional — excesso de sublimite de receita bruta",
  },
];

export const FOCUS_NFE_MODELO_NFCE = "NFC-e";
export const FOCUS_NFE_MODELO_NFE = "NF-e";
