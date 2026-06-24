import { supabase } from "@/lib/supabase";
import { humanizeEpocRemoteError } from "@/lib/epocRemoteErrorMessage";
import {
  normalizeEpocValidateLoginResponse,
  type EpocValidateLoginResponse,
} from "@/lib/setup/epocStep3ValidationGate";

export async function invokeValidateEpocLogin(params: {
  companyId: string;
  baseUrl: string;
  username: string;
  password: string;
  /** NaoMenu / código filial EPOC (opcional; alinha com settings do sync). */
  codigo_filial?: string;
}): Promise<EpocValidateLoginResponse> {
  const { companyId, baseUrl, username, password, codigo_filial } = params;
  const codigoFilialTrimmed = codigo_filial?.trim();
  try {
    const { data, error } = await supabase.functions.invoke<
      Record<string, unknown>
    >("epoc-validate-login", {
      body: {
        company_id: companyId,
        base_url: baseUrl,
        username,
        password,
        ...(codigoFilialTrimmed
          ? { codigo_filial: codigoFilialTrimmed }
          : {}),
      },
    });
    if (error) {
      return {
        success: false,
        errorCode: "SERVER_UNAVAILABLE",
        message: humanizeEpocRemoteError(
          error.message ||
            "Não foi possível contactar o serviço de validação EPOC.",
        ),
      };
    }
    return normalizeEpocValidateLoginResponse(data);
  } catch (e) {
    return {
      success: false,
      errorCode: "SERVER_UNAVAILABLE",
      message: humanizeEpocRemoteError(
        e instanceof Error ? e.message : "Falha de rede ao validar o EPOC.",
      ),
    };
  }
}
