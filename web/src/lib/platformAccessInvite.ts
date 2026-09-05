export type PlatformAccessInviteStatus = "active" | "pending" | "revoked";

/** Como tratar um acesso já existente ao convidar o mesmo e-mail. */
export function platformAccessInviteAction(
  existing: { status: string } | null,
): "create" | "reinvite" | "exists" {
  if (!existing) return "create";
  if (existing.status === "revoked") return "reinvite";
  return "exists";
}
