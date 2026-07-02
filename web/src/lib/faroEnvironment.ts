/** Supabase project ref do Faro Dev (`Faro - dev`). */
export const FARO_DEV_SUPABASE_PROJECT_REF = 'fpitscynfheqvboizppj'

export const FARO_DEV_BANNER_HEIGHT_PX = 28

export function isFaroDevEnvironment(): boolean {
  const explicit = import.meta.env.VITE_FARO_ENV?.trim().toLowerCase()
  if (explicit === 'production' || explicit === 'prod') return false
  if (explicit === 'dev' || explicit === 'development') return true

  const url = import.meta.env.VITE_SUPABASE_URL ?? ''
  if (!url) return false
  return url.includes(FARO_DEV_SUPABASE_PROJECT_REF)
}
