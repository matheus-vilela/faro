const ACTIVE_PHONE_MSG =
  "Este WhatsApp já está cadastrado como operador ativo nesta unidade.";

function errField(err: unknown, key: string): unknown {
  if (!err || typeof err !== "object" || !(key in err)) return undefined;
  return (err as Record<string, unknown>)[key];
}

/** Mensagem amigável para insert/update em `company_members`. */
export function mapCompanyMemberMutationError(err: unknown): string {
  const code = String(errField(err, "code") ?? "");
  const message = String(errField(err, "message") ?? "");
  const details = String(errField(err, "details") ?? "");
  const blob = `${code} ${message} ${details}`;
  const blobLower = blob.toLowerCase();

  if (blob.includes("Limite de 3")) {
    return "Limite de 3 operadores ativos por empresa.";
  }
  if (blobLower.includes("proprietário") || blobLower.includes("proprietario")) {
    return "Este número já é o do proprietário desta unidade.";
  }
  if (
    blob.includes("uq_company_members_active_phone") ||
    (code === "23505" && blobLower.includes("phone")) ||
    (blobLower.includes("duplicate key") && blobLower.includes("phone"))
  ) {
    return ACTIVE_PHONE_MSG;
  }
  if (code === "23505") {
    return ACTIVE_PHONE_MSG;
  }

  if (err instanceof Error && err.message.trim()) return err.message.trim();
  if (message.trim()) return message.trim();
  return "Não foi possível salvar o operador.";
}
