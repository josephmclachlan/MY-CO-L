import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useApp } from './AppContext'
import { dbLinked } from '../lib/supabase'
import { canOpenModule, canSeeMoney, loadLock, lockToStaff, roleFromUser, setOwnerPin, unlockWithPin, type DeviceLock, type Role } from '../lib/roles'

export interface RoleInfo {
  role: Role
  /** Where the role came from: the login, or the lock on this device. */
  source: 'login' | 'device'
  money: boolean
  canOpen: (moduleKey: string) => boolean
  lock: DeviceLock
  hasPin: boolean
  setPin: (pin: string) => Promise<void>
  lockStaff: () => void
  unlock: (pin: string) => Promise<{ ok: boolean; wait?: number; left?: number }>
}

const Ctx = createContext<RoleInfo | null>(null)

/** Who is using this screen: from the login when the database is linked, else from the lock on this device. */
export function RoleProvider({ children }: { children: ReactNode }) {
  const { session } = useApp()
  const [lock, setLock] = useState<DeviceLock>(loadLock)
  const linked = dbLinked
  const role: Role = linked ? roleFromUser(session?.user) : lock.role

  const setPin = useCallback(async (pin: string) => setLock(await setOwnerPin(pin)), [])
  const lockStaff = useCallback(() => setLock(lockToStaff()), [])
  const unlock = useCallback(async (pin: string) => {
    const r = await unlockWithPin(pin)
    setLock(loadLock())
    return r
  }, [])

  const value = useMemo<RoleInfo>(
    () => ({ role, source: linked ? 'login' : 'device', money: canSeeMoney(role), canOpen: (k) => canOpenModule(role, k), lock, hasPin: !!lock.hash, setPin, lockStaff, unlock }),
    [role, linked, lock, setPin, lockStaff, unlock],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useRole(): RoleInfo {
  const c = useContext(Ctx)
  if (!c) throw new Error('useRole must be used inside RoleProvider')
  return c
}
