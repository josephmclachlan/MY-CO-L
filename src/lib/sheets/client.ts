// Talks to the script inside the Google Sheet (sheets/Code.gs, deployed as a web app).
// A plain-text POST keeps the browser from asking permission first (no CORS preflight), which Apps Script cannot answer.

import { NetError } from '../sync'
import type { PullResult, PushRequest, SheetClient } from './types'

export type Fetcher = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

export const SCRIPT_URL = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/

export function checkUrl(url: string): string | null {
  const u = url.trim()
  if (!u) return 'PASTE THE WEB APP ADDRESS FIRST.'
  if (/\/dev$/.test(u)) return 'THAT IS THE TEST ADDRESS (ENDS IN /dev). USE THE WEB APP ADDRESS THAT ENDS IN /exec.'
  if (!SCRIPT_URL.test(u)) return 'THAT IS NOT A WEB APP ADDRESS. IT LOOKS LIKE https://script.google.com/macros/s/.../exec'
  return null
}

export class AppsScriptClient implements SheetClient {
  constructor(
    readonly url: string,
    private key: string,
    private fetcher: Fetcher = (u, i) => fetch(u, i),
  ) {}

  private async call<T>(op: string, body: Record<string, unknown> = {}): Promise<T> {
    let res
    try {
      res = await this.fetcher(this.url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ key: this.key, op, ...body }) })
    } catch {
      throw new NetError('NO SIGNAL: THE GOOGLE SHEET COULD NOT BE REACHED. IT WILL TRY AGAIN.')
    }
    const text = await res.text()
    if (!res.ok) throw new Error(`THE GOOGLE SHEET ANSWERED ${res.status}. CHECK THE WEB APP ADDRESS AND THAT WHO HAS ACCESS IS SET TO ANYONE.`)
    let j: unknown
    try {
      j = JSON.parse(text)
    } catch {
      throw new Error('THE ADDRESS DID NOT ANSWER WITH DATA. CHECK IT ENDS IN /exec AND THAT WHO HAS ACCESS IS SET TO ANYONE.')
    }
    const e = (j as { error?: unknown }).error
    if (e) throw new Error(`GOOGLE SHEET: ${String(e)}`)
    return j as T
  }

  hello() {
    return this.call<{ version: number; sheet: string; url?: string }>('hello')
  }
  pull(req: { since: string | null; full: boolean; tabs: string[] }) {
    return this.call<PullResult>('pull', req)
  }
  push(req: PushRequest) {
    return this.call<{ now: string; written: number }>('push', req as unknown as Record<string, unknown>)
  }
}
