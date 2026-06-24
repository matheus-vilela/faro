import { supabase } from "@/lib/supabase";

export type UndoProductMergeResult =
  | {
      ok: true;
      winnerId: string;
      restoredLoserId: string;
      undoMovementId: string | null;
    }
  | { ok: false; error: string };

export async function undoProductMerge(
  companyId: string,
  eventId: string,
): Promise<UndoProductMergeResult> {
  const { data, error } = await supabase.rpc("undo_product_merge", {
    p_company_id: companyId,
    p_event_id: eventId,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const row = data as {
    ok?: boolean;
    error?: string;
    message?: string;
    winner_id?: string;
    restored_loser_id?: string;
    undo_movement_id?: string;
  } | null;

  if (!row?.ok) {
    const code = String(row?.error ?? "undo_failed");
    const messages: Record<string, string> = {
      not_authenticated: "Sessão expirada. Entre novamente.",
      forbidden: "Sem permissão para desfazer unificação nesta unidade.",
      event_not_found: "Registro de unificação não encontrado ou já desfeito.",
      loser_already_exists:
        "O produto removido já existe no catálogo; não é possível desfazer.",
    };
    return {
      ok: false,
      error: messages[code] ?? row?.message ?? code,
    };
  }

  return {
    ok: true,
    winnerId: String(row.winner_id ?? ""),
    restoredLoserId: String(row.restored_loser_id ?? ""),
    undoMovementId: row.undo_movement_id ? String(row.undo_movement_id) : null,
  };
}
