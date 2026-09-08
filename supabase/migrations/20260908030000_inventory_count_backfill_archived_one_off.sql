-- Listas únicas já aprovadas antes do archived_at.

UPDATE public.inventory_count_listings l
SET archived_at = COALESCE(src.committed_at, NOW())
FROM (
  SELECT
    inventory_count_listing_id AS listing_id,
    MAX(committed_at) AS committed_at
  FROM public.inventory_count_sessions
  WHERE status = 'committed'
    AND inventory_count_listing_id IS NOT NULL
  GROUP BY inventory_count_listing_id
) src
WHERE l.id = src.listing_id
  AND l.inventory_count_group_id IS NULL
  AND l.archived_at IS NULL;

UPDATE public.inventory_count_schedules s
SET active = false, updated_at = NOW()
FROM public.inventory_count_listings l
WHERE s.inventory_count_listing_id = l.id
  AND l.archived_at IS NOT NULL
  AND s.active;
