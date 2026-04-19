import { maskCep, unmask } from "@/lib/masks";
import type { EnderecoPrincipalMap } from "@/types/companySetup";

export type ViaCepResponse = {
  cep?: string;
  logradouro?: string;
  complemento?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  ibge?: string;
  erro?: boolean;
};

export async function fetchAddressByCep(
  cepRaw: string,
): Promise<{ ok: true; data: EnderecoPrincipalMap } | { ok: false; error: string }> {
  const digits = unmask(cepRaw);
  if (digits.length !== 8) {
    return { ok: false, error: "CEP deve ter 8 dígitos." };
  }
  const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
  if (!res.ok) {
    return { ok: false, error: "Não foi possível consultar o CEP. Tente novamente." };
  }
  const json = (await res.json()) as ViaCepResponse;
  if (json.erro) {
    return { ok: false, error: "CEP não encontrado." };
  }
  return {
    ok: true,
    data: {
      cep: maskCep(json.cep ?? digits),
      logradouro: json.logradouro ?? "",
      complemento: json.complemento ?? "",
      bairro: json.bairro ?? "",
      municipio: json.localidade ?? "",
      uf: json.uf ?? "",
      ibge_cidade: json.ibge ?? "",
    },
  };
}
