import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { SoundEngine } from '../audio/engine'
import { supabase } from '../lib/supabase'
import { DEFAULTS, loadSettings, saveSettings, type Settings } from './settings'

interface AppCtx {
  settings: Settings
  update: (fn: (s: Settings) => Settings) => void
  reset: () => void
  sound: SoundEngine
  session: Session | null
}

const Ctx = createContext<AppCtx | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const engineRef = useRef<SoundEngine | null>(null)
  if (!engineRef.current) engineRef.current = new SoundEngine(settings.sound)
  const sound = engineRef.current
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => {
    saveSettings(settings)
    sound.apply(settings.sound)
  }, [settings, sound])

  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const update = useCallback((fn: (s: Settings) => Settings) => setSettings((s) => fn(s)), [])
  const reset = useCallback(
    () => setSettings((s) => ({ ...structuredClone(DEFAULTS), bootSeen: s.bootSeen })),
    [],
  )

  const value = useMemo(() => ({ settings, update, reset, sound, session }), [settings, update, reset, sound, session])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useApp must be used inside AppProvider')
  return c
}
