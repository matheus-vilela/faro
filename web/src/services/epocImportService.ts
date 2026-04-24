/**
 * Contratos para importação de dados a partir do PDV (EPOC) via credenciais.
 * Implementação completa fica para iteração futura.
 */

export type EpocCredentialsInput = {
  username: string;
  password: string;
  base_url?: string;
  codigo_filial?: string;
};

export type EpocExcelImportInput = {
  companyId: string;
  storagePath: string;
  fileName: string;
};

export type EpocImportPreview = {
  fornecedores: number;
  produtos: number;
  despesas: number;
  categorias: number;
};

export async function previewEpocImportFromCredentials(
  _companyId: string,
  _creds: EpocCredentialsInput,
): Promise<{ ok: true; preview: EpocImportPreview } | { ok: false; error: string }> {
  return {
    ok: true,
    preview: { fornecedores: 0, produtos: 0, despesas: 0, categorias: 0 },
  };
}

export async function runEpocImportFromExcel(
  _input: EpocExcelImportInput,
): Promise<{ ok: boolean; error?: string }> {
  return { ok: true };
}
