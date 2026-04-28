import type { EpocAmbiente } from "@/types/companyIntegration";

/** Status do assistente de configuração persistido em companies.setup */
export type CompanySetupStatus =
  | "not_started"
  | "in_progress"
  | "paused"
  | "completed";

/** Passos 1–4: empresa, certificado, XML/ZIP, PDV (endereço vem da consulta CNPJ). */
export type SetupStepNumber = 1 | 2 | 3 | 4;

export type EmpresaMap = {
  nome_razao_social?: string;
  nome_fantasia?: string;
  cnpj_cpf?: string;
  inscricao_estadual?: string;
  regime_tributario?: number;
  email?: string;
  telefone?: string;
  photo_base64?: string;
  /** Preenchidos pela consulta CNPJ Focus (persistidos). */
  situacao_cadastral?: string;
  cnae_principal?: string;
  optante_simples_nacional?: boolean;
  optante_mei?: boolean;
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
  codigo_municipio?: string;
  codigo_siafi?: string;
};

/** Representante legal (opcional; preenchido pela API CNPJ quando existir). */
export type RepresentanteLegalMap = {
  nome_responsavel?: string;
  /** Apenas dígitos */
  cpf_responsavel?: string;
  /** ISO YYYY-MM-DD */
  data_nascimento?: string;
};

/** Campos bloqueados após consulta CNPJ bem-sucedida (até o CNPJ mudar). */
export type FocusCnpjLockState = {
  validated_cnpj_digits: string;
  validated_at: string;
  locked_empresa_keys: string[];
  locked_endereco_keys: string[];
  locked_representante_keys: string[];
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
  /** Id da empresa na API Focus NFe (preenchido após `focus-cria-empresa`). */
  id_empresa?: number;
  /**
   * Uso apenas em memória / body para APIs Focus — **nunca** persistir em `companies.focusnfe`.
   */
  arquivo_certificado_base64?: string;
  /** Idem: só fluxo de request; não gravar no banco. */
  senha_certificado?: string;
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
  | "queued"
  | "processing"
  | "done"
  | "error";

export type XmlZipFileLogEntry = {
  name: string;
  ok: boolean;
  status?:
    | "success"
    | "duplicate"
    | "read_error"
    | "validation_error"
    | "needs_review"
    | "cancelled";
  message?: string;
};

export type SetupXmlZipImportState = {
  phase: XmlZipImportPhase;
  job_batch_id?: string;
  storage_path?: string;
  file_name?: string;
  error_message?: string;
  file_log: XmlZipFileLogEntry[];
  updated_at?: string;
};

export type EpocWizardMode = "undecided" | "no" | "credentials";

export type SetupEpocState = {
  mode: EpocWizardMode;
  /** Rascunho local antes de gravar em company_integrations */
  enabled?: boolean;
  username?: string;
  password?: string;
  base_url?: string;
  codigo_filial?: string;
  ambiente?: EpocAmbiente;
  /** Indica que já existe senha salva em company_integrations (não vem no estado por segurança). */
  password_on_server?: boolean;
  updated_at?: string;
};

/** Snapshot do passo "Classificação de itens" (RPC `get_item_classification_onboarding_status`). */
export type ItemClassificationOnboardingSnapshot = {
  total_products: number;
  incomplete: number;
  percent: number;
  synced_at?: string;
};

export type CompanySetupMap = {
  status: CompanySetupStatus;
  /**
   * 2 = 5 passos (legado, com endereço manual); 3 = 4 passos (endereço via consulta CNPJ).
   * &lt; 2: 6 passos muito antigo — migrar ao normalizar.
   */
  setup_schema_version?: number;
  /** Preenchido ao visitar o passo de classificação de itens (evita concluir o passo com pendências). */
  item_classification_onboarding?: ItemClassificationOnboardingSnapshot;
  current_step: number;
  completed_steps: number[];
  skipped_steps: number[];
  progress_percent: number;
  started_at?: string;
  updated_at?: string;
  completed_at?: string;
  last_paused_at?: string;
  /** Estado da última validação de CNPJ via Focus (bloqueios de edição). */
  focus_cnpj_lock?: FocusCnpjLockState;
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
