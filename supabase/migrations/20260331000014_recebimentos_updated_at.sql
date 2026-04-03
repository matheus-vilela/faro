-- Lista de recebimentos: ordenar por última atualização do registro
DROP INDEX IF EXISTS public.idx_recebimentos_sort_at_desc;
ALTER TABLE public.recebimentos DROP COLUMN IF EXISTS sort_at;

ALTER TABLE public.recebimentos
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT NOW();

COMMENT ON COLUMN public.recebimentos.updated_at IS
  'Atualizado automaticamente a cada UPDATE na linha; usado para ordenar a listagem.';

UPDATE public.recebimentos
SET updated_at = COALESCE(received_at, created_at);

DROP TRIGGER IF EXISTS tr_recebimentos_updated_at ON public.recebimentos;
CREATE TRIGGER tr_recebimentos_updated_at
  BEFORE UPDATE ON public.recebimentos
  FOR EACH ROW
  EXECUTE PROCEDURE public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_recebimentos_updated_at_desc ON public.recebimentos (updated_at DESC);
