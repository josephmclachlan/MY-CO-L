// Supabase connection. The URL and PUBLIC key come from environment variables
// set in Cloudflare (or .env.local on a laptop). If they are missing, the app
// runs in LOCAL MODE: everything that doesn't need the database still works.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_KEY as string | undefined

export const supabase: SupabaseClient | null =
  url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } }) : null

export const dbLinked = supabase !== null
