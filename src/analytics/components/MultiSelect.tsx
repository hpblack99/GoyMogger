import { useState, useRef, useEffect, useCallback } from 'react'
import styles from './MultiSelect.module.css'

interface Props {
  label: string
  options: string[]
  value: string[]
  onChange: (v: string[]) => void
  allLabel?: string
}

export default function MultiSelect({ label, options, value, onChange, allLabel = 'All' }: Props) {
  const [open, setOpen]     = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = options.filter(o => o.toLowerCase().includes(search.toLowerCase()))

  const toggle = useCallback((opt: string) => {
    onChange(value.includes(opt) ? value.filter(v => v !== opt) : [...value, opt])
  }, [value, onChange])

  const clear = useCallback(() => { onChange([]); setSearch('') }, [onChange])
  const selectAll = useCallback(() => { onChange([...options]); setSearch('') }, [options, onChange])

  const summary = value.length === 0
    ? allLabel
    : value.length === 1
      ? value[0]
      : `${value.length} selected`

  return (
    <div className={styles.wrap} ref={ref}>
      <span className={styles.fieldLabel}>{label}</span>
      <button
        className={`${styles.trigger} ${open ? styles.triggerOpen : ''} ${value.length > 0 ? styles.triggerActive : ''}`}
        onClick={() => { setOpen(o => !o); setSearch('') }}
        type="button"
      >
        <span className={styles.triggerText}>{summary}</span>
        <span className={styles.arrow}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className={styles.dropdown}>
          <div className={styles.searchWrap}>
            <input
              className={styles.search}
              placeholder="Search…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
            />
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.action} onClick={selectAll}>All</button>
            <button type="button" className={styles.action} onClick={clear}>Clear</button>
          </div>
          <ul className={styles.list}>
            {filtered.length === 0 && (
              <li className={styles.empty}>No matches</li>
            )}
            {filtered.map(opt => (
              <li key={opt} className={styles.item} onClick={() => toggle(opt)}>
                <span className={`${styles.checkbox} ${value.includes(opt) ? styles.checked : ''}`}>
                  {value.includes(opt) ? '✓' : ''}
                </span>
                <span className={styles.optLabel}>{opt}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
