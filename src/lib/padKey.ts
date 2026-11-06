// What a number-pad key does to the text in a box (glove mode). Pure, so the tests can run it.

/** Pure: what a key does to the text in a box. Used by the pad and by the tests. */
export function padKey(cur: string, key: string, decimal: boolean, maxLength = 24): string {
  if (key === 'BACK') return cur.slice(0, -1)
  if (key === 'CLEAR') return ''
  if (key === 'SIGN') {
    if (!decimal) return cur
    if (cur.startsWith('-')) return cur.slice(1)
    return cur.length < maxLength ? (cur ? `-${cur}` : '-') : cur
  }
  if (key === '.') {
    if (!decimal || cur.includes('.')) return cur
    const base = cur === '' || cur === '-' ? `${cur}0` : cur
    return base.length < maxLength ? `${base}.` : cur
  }
  if (/^\d$/.test(key)) {
    if (cur.length >= maxLength) return cur
    // 0 then a digit replaces the 0 (07 -> 7), except 0. which is a decimal.
    if (cur === '0') return key
    if (cur === '-0') return `-${key}`
    return cur + key
  }
  return cur
}
