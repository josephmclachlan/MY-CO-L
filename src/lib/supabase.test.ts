import { describe, expect, it } from 'vitest'
import { resolveDbUrl } from './supabase'

describe('database address', () => {
  it('uses the page address on the farm box (self)', () => {
    expect(resolveDbUrl('self', 'https://farm-box.tail1234.ts.net', '/')).toBe('https://farm-box.tail1234.ts.net')
    expect(resolveDbUrl('self', 'http://192.168.1.20:8080', '/MY-CO-L/')).toBe('http://192.168.1.20:8080/MY-CO-L')
  })
  it('keeps a normal Supabase address as it is', () => {
    expect(resolveDbUrl('https://abcd.supabase.co', 'https://x', '/')).toBe('https://abcd.supabase.co')
    expect(resolveDbUrl(undefined, 'https://x', '/')).toBeUndefined()
  })
})
