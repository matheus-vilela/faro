-- Feedback de qualidade do rascunho IA (acertou/parcial/ruim) no contexto de recebimento.

CREATE OR REPLACE FUNCTION public.submit_import_recipe_draft_feedback_for_recebimento(
  p_token UUID,
  p_draft_id UUID,
  p_feedback_label TEXT,
  p_feedback_notes TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok BOOLEAN;
BEGIN
  IF p_feedback_label NOT IN ('ACERTOU', 'PARCIAL', 'RUIM') THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_feedback_label');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.import_recipe_drafts d
    JOIN public.recebimentos r
      ON r.expense_id = (SELECT ei.expense_id FROM public.expense_items ei WHERE ei.id = d.expense_item_id)
    WHERE d.id = p_draft_id
      AND r.token = p_token
      AND r.status <> 'received'
  )
  INTO v_ok;

  IF NOT COALESCE(v_ok, false) THEN
    RETURN json_build_object('ok', false, 'error', 'invalid_token_or_draft');
  END IF;

  UPDATE public.import_recipe_drafts d
  SET
    reasons_json = COALESCE(d.reasons_json, '{}'::jsonb) ||
      jsonb_build_object(
        'feedback_label', p_feedback_label,
        'feedback_notes', NULLIF(btrim(COALESCE(p_feedback_notes, '')), ''),
        'feedback_at', NOW()
      ),
    updated_at = NOW()
  WHERE d.id = p_draft_id;

  RETURN json_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_import_recipe_draft_feedback_for_recebimento(UUID, UUID, TEXT, TEXT) TO anon, authenticated;
