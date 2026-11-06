// Supabase connection. The URL and PUBLIC key come from environment variables
// set in Cloudflare (or .env.local on a laptop). If they are missing, the app
// runs in LOCAL MODE: everything that doesn't need the database still works.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const rawUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_KEY as string | undefined

/**
 * SELF-HOSTED (the farm box, selfhost/): the build sets VITE_SUPABASE_URL=self, and the data and login
 * live under the same address the page was opened from (/rest/v1, /auth/v1). One build then works from
 * the Tailscale name, a Cloudflare name or the farm wifi address alike.
 */
export const selfHosted = rawUrl === 'self'
export function resolveDbUrl(raw: string | undefined, origin: string, base: string): string | undefined {
  if (raw !== 'self') return raw
  return new URL(base || '/', origin).href.replace(/\/+$/, '')
}
const url = resolveDbUrl(rawUrl, globalThis.location?.origin ?? 'http://localhost', import.meta.env.BASE_URL)

export const supabase: SupabaseClient | null =
  url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } }) : null

export const dbLinked = supabase !== null
