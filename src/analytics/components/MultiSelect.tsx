import { useState, useRef, useEffect, useCallback } from 'react'
import styles from './MultiSelect.module.css'

export interface OptionGroup {
  label: string
  match: (option: string) => boolean
}

interface Props {
  label: string
  options: string[]
  value: string[]
  onChange: (v: string[]) => void
  allLabel?: string
  groups?: OptionGroup[]
}

export default function MultiSelect({ label, options, value, onChange, allLabel = 'All', groups = [] }: Props) {
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

  const norm = (s: string) => s.toLowerCase()
  const filtered = options.filter(o => norm(o).includes(norm(search)))

  const toggle = useCallback((opt: string) => {
    onChange(value.includes(opt) ? value.filter(v => v !== opt) : [...value, opt])
  }, [value, onChange])

  const clear      = useCallback(() => { onChange([]);             setSearch('') }, [onChange])
  const selectAll  = useCallback(() => { onChange([...options]);   setSearch('') }, [options, onChange])

  // Group helpers
  const groupMembers = (g: OptionGroup) => options.filter(o => g.match(o))
  const groupSelectedCount = (g: OptionGroup) => groupMembers(g).filter(o => value.includes(o)).length
  const toggleGroup = (g: OptionGroup) => {
    const members = groupMembers(g)
    const allSelected = members.every(o => value.includes(o))
    if (allSelected) {
      onChange(value.filter(o => !members.includes(o)))
    } else {
      const toAdd = members.filter(o => !value.includes(o))
      onChange([...value, ...toAdd])
    }
  }

  // Which options belong to a group (for rendering — ungrouped options shown separately)
  const groupedOptions = new Set(groups.flatMap(g => options.filter(o => g.match(o))))

  // Build the render list: interleave group headers + members, then ungrouped
  type RenderItem =
    | { kind: 'group'; group: OptionGroup }
    | { kind: 'member'; opt: string; group: OptionGroup }
    | { kind: 'option'; opt: string }

  const renderItems: RenderItem[] = []

  for (const g of groups) {
    const members = filtered.filter(o => g.match(o))
    if (members.length === 0) continue
    renderItems.push({ kind: 'group', group: g })
    for (const opt of members) {
      renderItems.push({ kind: 'member', opt, group: g })
    }
  }
  for (const opt of filtered) {
    if (!groupedOptions.has(opt)) {
      renderItems.push({ kind: 'option', opt })
    }
  }

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
            {renderItems.length === 0 && (
              <li className={styles.empty}>No matches</li>
            )}
            {renderItems.map((item, i) => {
              if (item.kind === 'group') {
                const total    = groupMembers(item.group).length
                const selected = groupSelectedCount(item.group)
                const allSel   = selected === total
                const someSel  = selected > 0 && !allSel
                return (
                  <li key={`g-${i}`} className={`${styles.item} ${styles.groupHeader}`} onClick={() => toggleGroup(item.group)}>
                    <span className={`${styles.checkbox} ${allSel ? styles.checked : someSel ? styles.indeterminate : ''}`}>
                      {allSel ? '✓' : someSel ? '–' : ''}
                    </span>
                    <span className={styles.groupLabel}>{item.group.label}</span>
                    <span className={styles.groupCount}>{selected}/{total}</span>
                  </li>
                )
              }
              if (item.kind === 'member') {
                return (
                  <li key={item.opt} className={`${styles.item} ${styles.memberItem}`} onClick={() => toggle(item.opt)}>
                    <span className={`${styles.checkbox} ${value.includes(item.opt) ? styles.checked : ''}`}>
                      {value.includes(item.opt) ? '✓' : ''}
                    </span>
                    <span className={styles.optLabel}>{item.opt}</span>
                  </li>
                )
              }
              return (
                <li key={item.opt} className={styles.item} onClick={() => toggle(item.opt)}>
                  <span className={`${styles.checkbox} ${value.includes(item.opt) ? styles.checked : ''}`}>
                    {value.includes(item.opt) ? '✓' : ''}
                  </span>
                  <span className={styles.optLabel}>{item.opt}</span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
