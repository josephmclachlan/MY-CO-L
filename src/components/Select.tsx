import { Children, Fragment, isValidElement, useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'

/**
 * In-app drop-down. Used instead of the browser's <select> so phones (iPhone
 * especially) open this list inside the terminal rather than the system picker.
 * Takes the same props and <option> / <optgroup> children as <select>, and
 * calls onChange with { target: { value } } so existing handlers keep working.
 */
interface Opt { value: string; label: string; disabled?: boolean; group?: string }

function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children)
  return ''
}

function collect(children: ReactNode, group: string | undefined, out: Opt[]) {
  Children.forEach(children, (c) => {
    if (!isValidElement(c)) return
    const el = c as ReactElement<{ value?: string | number; disabled?: boolean; label?: string; children?: ReactNode }>
    if (el.type === 'option') {
      const label = textOf(el.props.children)
      out.push({ value: el.props.value != null ? String(el.props.value) : label, label, disabled: el.props.disabled, group })
    } else if (el.type === 'optgroup') {
      collect(el.props.children, el.props.label, out)
    } else {
      collect(el.props.children, group, out)
    }
  })
}

export interface SelectProps {
  value: string | number
  onChange: (e: { target: { value: string } }) => void
  children?: ReactNode
  disabled?: boolean
  className?: string
  'aria-label'?: string
}

export function Select({ value, onChange, children, disabled, className, 'aria-label': ariaLabel }: SelectProps) {
  const opts = useMemo(() => {
    const out: Opt[] = []
    collect(children, undefined, out)
    return out
  }, [children])
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const [up, setUp] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const id = useId()
  const cur = opts.findIndex((o) => o.value === String(value))
  const label = cur >= 0 ? opts[cur].label : opts[0]?.label ?? ''

  const openList = () => {
    if (disabled) return
    const r = root.current?.getBoundingClientRect()
    setUp(!!r && window.innerHeight - r.bottom < 300 && r.top > window.innerHeight - r.bottom)
    setHi(Math.max(0, cur))
    setOpen(true)
  }
  const pick = (i: number) => {
    const o = opts[i]
    if (!o || o.disabled) return
    setOpen(false)
    if (o.value !== String(value)) onChange({ target: { value: o.value } })
  }

  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  useEffect(() => {
    if (open) list.current?.querySelector('[data-hi="1"]')?.scrollIntoView({ block: 'nearest' })
  }, [open, hi])

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openList() }
      return
    }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setHi((h) => Math.min(opts.length - 1, h + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setHi((h) => Math.max(0, h - 1)) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); pick(hi) }
    else if (e.key === 'Home' || e.key === 'PageUp') { e.preventDefault(); e.stopPropagation(); setHi((h) => (e.key === 'Home' ? 0 : Math.max(0, h - 8))) }
    else if (e.key === 'End' || e.key === 'PageDown') { e.preventDefault(); e.stopPropagation(); setHi((h) => (e.key === 'End' ? opts.length - 1 : Math.min(opts.length - 1, h + 8))) }
    else if (e.key === 'Tab') setOpen(false)
    else if (e.key.length === 1 && /\S/.test(e.key)) {
      // Type a letter to jump to the next option that starts with it.
      e.preventDefault()
      e.stopPropagation()
      const ch = e.key.toUpperCase()
      for (let k = 1; k <= opts.length; k++) {
        const j = (hi + k) % opts.length
        if (!opts[j].disabled && opts[j].label.trim().toUpperCase().startsWith(ch)) { setHi(j); break }
      }
    }
  }

  let lastGroup: string | undefined
  return (
    <span className={`ui-select ${open ? 'open' : ''} ${up ? 'up' : ''} ${className ?? ''}`} ref={root}>
      <button
        type="button"
        className="ui-select-btn"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKey}
      >
        <span className="ui-select-val">{label}</span>
        <span className="ui-select-caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <ul className="ui-select-list" id={id} role="listbox" ref={list} onClick={(e) => e.preventDefault()}>
          {opts.map((o, i) => {
            const head = o.group && o.group !== lastGroup ? <li className="ui-select-group" role="presentation" key={`g${i}`}>{o.group}</li> : null
            lastGroup = o.group
            return (
              <Fragment key={`o${i}`}>
                {head}
                <li
                  role="option"
                  aria-selected={i === cur}
                  aria-disabled={o.disabled}
                  data-hi={i === hi ? '1' : undefined}
                  className={`ui-select-opt${i === cur ? ' cur' : ''}${i === hi ? ' hi' : ''}${o.disabled ? ' off' : ''}`}
                  onPointerEnter={() => setHi(i)}
                  onClick={() => pick(i)}
                >
                  {o.label}
                </li>
              </Fragment>
            )
          })}
        </ul>
      )}
    </span>
  )
}
