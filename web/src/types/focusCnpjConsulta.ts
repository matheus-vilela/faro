/**
 * Resposta da edge function `focus-consulta-cnpj` / dados Focus de consulta CNPJ.
 * Campos extras da API são aceitos e persistidos como JSON bruto quando necessário.
 */
export type FocusCnpjEndereco = {
  codigo_municipio?: string;
  codigo_siafi?: string;
  codigo_ibge?: string;
  nome_municipio?: string;
  logradouro?: string;
  complemento?: string;
  numero?: string;
  bairro?: string;
  cep?: string;
  uf?: string;
};

export type FocusCnpjConsultaData = {
  razao_social?: string;
  cnpj?: string;
  situacao_cadastral?: string;
  cnae_principal?: string;
  optante_simples_nacional?: boolean;
  optante_mei?: boolean;
  endereco?: FocusCnpjEndereco;
  /** Quando a API enviar representante (formato pode variar). */
  nome_responsavel?: string;
  cpf_responsavel?: string;
  data_nascimento?: string;
  [key: string]: unknown;
};
