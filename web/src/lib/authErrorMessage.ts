type AuthErrorContext =
  | "login"
  | "signup"
  | "forgot_password"
  | "reset_password";

type AuthErrorLike = {
  message?: string;
  code?: string;
  status?: number;
};

const FALLBACK: Record<AuthErrorContext, string> = {
  login: "Não foi possível entrar. Tente novamente.",
  signup: "Não foi possível criar a conta. Tente novamente.",
  forgot_password: "Não foi possível enviar o e-mail. Tente novamente.",
  reset_password: "Não foi possível salvar a nova senha. Tente novamente.",
};

const BY_CODE: Record<string, string> = {
  email_not_confirmed:
    "Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada e a pasta de spam.",
  invalid_credentials: "E-mail ou senha incorretos.",
  user_not_found: "Não encontramos uma conta com este e-mail.",
  user_already_exists: "Já existe uma conta com este e-mail. Faça login ou recupere a senha.",
  email_exists: "Já existe uma conta com este e-mail. Faça login ou recupere a senha.",
  weak_password: "A senha é fraca. Use pelo menos 6 caracteres.",
  same_password: "A nova senha deve ser diferente da senha atual.",
  over_request_rate_limit:
    "Muitas tentativas em sequência. Aguarde um momento e tente de novo.",
  over_email_send_rate_limit:
    "Enviamos e-mails recentemente. Aguarde alguns minutos antes de tentar novamente.",
  signup_disabled: "Novos cadastros estão temporariamente indisponíveis.",
  email_address_invalid: "Informe um endereço de e-mail válido.",
  validation_failed: "Verifique os dados informados e tente novamente.",
  session_expired: "Sua sessão expirou. Solicite um novo link de recuperação.",
  flow_state_expired: "Este link expirou. Solicite um novo e-mail de recuperação.",
  flow_state_not_found: "Este link é inválido ou já foi usado. Solicite um novo e-mail.",
};

const BY_MESSAGE: Record<string, string> = {
  "email not confirmed":
    "Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada e a pasta de spam.",
  "invalid login credentials": "E-mail ou senha incorretos.",
  "invalid email or password": "E-mail ou senha incorretos.",
  "user already registered":
    "Já existe uma conta com este e-mail. Faça login ou recupere a senha.",
  "password should be at least 6 characters":
    "A senha deve ter pelo menos 6 caracteres.",
  "signup requires a valid password":
    "Informe uma senha válida com pelo menos 6 caracteres.",
  "email rate limit exceeded":
    "Enviamos e-mails recentemente. Aguarde alguns minutos antes de tentar novamente.",
  "for security purposes, you can only request this once every 60 seconds":
    "Por segurança, aguarde cerca de 1 minuto antes de solicitar outro e-mail.",
  "new password should be different from the old password":
    "A nova senha deve ser diferente da senha atual.",
  "failed to fetch": "Verifique sua conexão com a internet e tente novamente.",
  "network request failed":
    "Verifique sua conexão com a internet e tente novamente.",
};

function normalizeMessage(message: string): string {
  return message.trim().toLowerCase().replace(/\s+/g, " ");
}

function asAuthError(err: unknown): AuthErrorLike | null {
  if (!err || typeof err !== "object") return null;
  const e = err as AuthErrorLike;
  if (typeof e.message !== "string" && typeof e.code !== "string") return null;
  return e;
}

function matchByMessage(message: string): string | null {
  const normalized = normalizeMessage(message);
  if (BY_MESSAGE[normalized]) return BY_MESSAGE[normalized];

  if (normalized.includes("email not confirmed")) {
    return BY_CODE.email_not_confirmed;
  }
  if (
    normalized.includes("invalid login") ||
    normalized.includes("invalid credentials")
  ) {
    return BY_CODE.invalid_credentials;
  }
  if (normalized.includes("already registered") || normalized.includes("already exists")) {
    return BY_CODE.user_already_exists;
  }
  if (normalized.includes("rate limit")) {
    return BY_CODE.over_email_send_rate_limit;
  }
  if (normalized.includes("at least 6 characters")) {
    return BY_CODE.weak_password;
  }
  if (normalized.includes("once every") && normalized.includes("seconds")) {
    return BY_MESSAGE[
      "for security purposes, you can only request this once every 60 seconds"
    ];
  }

  return null;
}

/** Traduz erros do Supabase Auth para mensagens amigáveis em português. */
export function humanizeAuthError(
  err: unknown,
  context: AuthErrorContext = "login",
): string {
  if (typeof err === "string") {
    return matchByMessage(err) ?? err;
  }

  const authErr = asAuthError(err);
  if (!authErr) {
    return FALLBACK[context];
  }

  const code = authErr.code?.trim().toLowerCase();
  if (code && BY_CODE[code]) {
    return BY_CODE[code];
  }

  const message = authErr.message?.trim();
  if (message) {
    const mapped = matchByMessage(message);
    if (mapped) return mapped;
  }

  if (authErr.status === 429) {
    return BY_CODE.over_request_rate_limit;
  }

  return message && /[áàâãéêíóôõúç]/i.test(message)
    ? message
    : FALLBACK[context];
}
