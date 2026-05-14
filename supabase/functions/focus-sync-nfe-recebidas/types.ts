export type Phase = "list" | "download" | "auto";

export type QueueRow = {
  id: string;
  company_id: string;
  nfe_access_key: string;
  versao: number | null;
  status: string;
  batch_id: string | null;
  attempt_count: number;
  last_error: string | null;
};

export type NfeCab = {
  chave_nfe: string;
  versao?: number;
  situacao?: string;
  nfe_completa?: boolean;
  nome_emitente?: string;
  valor_total?: number | string;
  valor?: number | string;
  total?: number | string;
};

export type CoRow = {
  id: string;
  document?: string | null;
  focusnfe?: Record<string, unknown>;
};
