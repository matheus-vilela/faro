-- Nome da ficha = nome do produto. Tipo (ficha / produção) só no front.

DO $$
DECLARE
  r record;
  def text;
  new_def text;
  updated int := 0;
BEGIN
  FOR r IN
    SELECT
      p.oid,
      p.proname,
      pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND pg_get_functiondef(p.oid) ~ '— ficha técnica|— produção'
  LOOP
    def := pg_get_functiondef(r.oid);
    new_def := replace(
      def,
      $s$trim(v_out_name) || CASE WHEN v_is_intermediate THEN ' — produção' ELSE ' — ficha técnica' END$s$,
      $s$trim(v_out_name)$s$
    );
    new_def := replace(
      new_def,
      $s$trim(v_out_name) || ' — ficha técnica'$s$,
      $s$trim(v_out_name)$s$
    );
    new_def := replace(
      new_def,
      $s$trim(v_name) || ' — ficha técnica'$s$,
      $s$trim(v_name)$s$
    );
    IF new_def IS DISTINCT FROM def THEN
      EXECUTE new_def;
      updated := updated + 1;
      RAISE NOTICE 'recipe name suffix removed: public.%(%)', r.proname, r.args;
    END IF;
  END LOOP;

  RAISE NOTICE 'recipe_name_no_rpc_suffix: % funções atualizadas', updated;
END $$;

UPDATE public.recipes
SET
  name = left(
    trim(
      regexp_replace(
        name,
        '\s+[—–-]\s*(ficha técnica|produção)\s*$',
        '',
        'i'
      )
    ),
    500
  ),
  updated_at = now()
WHERE name ~* '[—–-]\s*(ficha técnica|produção)\s*$';
