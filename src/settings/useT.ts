import { useCallback } from 'react'
import { useApp } from './AppContext'
import { tr, trf, type Lang } from '../lib/i18n'

/** t('TEXT') and tf('TEXT {n}', { n }) in the language this device is set to. */
export function useT() {
  const { settings } = useApp()
  const lang: Lang = settings.lang
  const t = useCallback((s: string) => tr(lang, s), [lang])
  const tf = useCallback((s: string, v: Record<string, string | number>) => trf(lang, s, v), [lang])
  return { t, tf, lang }
}
