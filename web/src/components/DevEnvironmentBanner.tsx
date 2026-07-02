import {
  FARO_DEV_BANNER_HEIGHT_PX,
  isFaroDevEnvironment,
} from '@/lib/faroEnvironment'
import { useEffect } from 'react'

export function DevEnvironmentBanner() {
  const isDev = isFaroDevEnvironment()

  useEffect(() => {
    if (!isDev) {
      document.documentElement.style.setProperty('--faro-dev-banner-height', '0px')
      return
    }

    document.documentElement.style.setProperty(
      '--faro-dev-banner-height',
      `${FARO_DEV_BANNER_HEIGHT_PX}px`,
    )

    return () => {
      document.documentElement.style.setProperty('--faro-dev-banner-height', '0px')
    }
  }, [isDev])

  if (!isDev) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center border-b border-orange-700/30 bg-orange-600 px-3 text-center text-xs font-semibold tracking-wide text-white shadow-sm dark:border-orange-400/20 dark:bg-orange-500"
      style={{ height: FARO_DEV_BANNER_HEIGHT_PX }}
    >
      Ambiente de desenvolvimento — banco Dev
    </div>
  )
}
