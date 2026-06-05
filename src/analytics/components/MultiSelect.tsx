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
  const [open, setOpen]           = useState(false)
  const [search, setSearch]       = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [dropHeight, setDropHeight] = useState(280)
  const wrapRef      = useRef<HTMLDivElement>(null)
  const dropRef      = useRef<HTMLDivElement>(null)
  const resizingRef  = useRef(false)
  const resizeStartY = useRef(0)
  const resizeStartH = useRef(0)

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Resize drag handlers
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return
      const delta = e.clientY - resizeStartY.current
      setDropHeight(Math.max(160, Math.min(600, resizeStartH.current + delta)))
    }
    const onUp = () => { resizingRef.current = false }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [])

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault()
    resizingRef.current = true
    resizeStartY.current = e.clientY
    resizeStartH.current = dropHeight
  }

  const norm = (s: string) => s.toLowerCase()
  const filtered = options.filter(o => norm(o).includes(norm(search)))

  const toggle = useCallback((opt: string) => {
    onChange(value.includes(opt) ? value.filter(v => v !== opt) : [...value, opt])
  }, [value, onChange])

  const clear     = useCallback(() => { onChange([]);           setSearch('') }, [onChange])
  const selectAll = useCallback(() => { onChange([...options]); setSearch('') }, [options, onChange])

  const groupMembers       = (g: OptionGroup) => options.filter(o => g.match(o))
  const groupSelectedCount = (g: OptionGroup) => groupMembers(g).filter(o => value.includes(o)).length

  const toggleGroupSelect = (g: OptionGroup, e: React.MouseEvent) => {
    e.stopPropagation()
    const members   = groupMembers(g)
    const allSelected = members.every(o => value.includes(o))
    if (allSelected) onChange(value.filter(o => !members.includes(o)))
    else onChange([...value, ...members.filter(o => !value.includes(o))])
  }

  const toggleGroupExpand = (label: string) => {
    setExpandedGroups(prev => {
      const n = new Set(prev)
      n.has(label) ? n.delete(label) : n.add(label)
      return n
    })
  }

  const groupedOptions = new Set(groups.flatMap(g => options.filter(o => g.match(o))))

  const summary = value.length === 0
    ? allLabel
    : value.length === 1
      ? value[0]
      : `${value.length} selected`

  return (
    <div className={styles.wrap} ref={wrapRef}>
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
        <div className={styles.dropdown} ref={dropRef} style={{ height: dropHeight }}>
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
            {/* Umbrella groups */}
            {groups.map(g => {
              const members  = filtered.filter(o => g.match(o))
              if (members.length === 0) return null
              const total    = groupMembers(g).length
              const selected = groupSelectedCount(g)
              const allSel   = selected === total
              const someSel  = selected > 0 && !allSel
              const expanded = expandedGroups.has(g.label)

              return (
                <li key={g.label}>
                  {/* Group header row */}
                  <div
                    className={styles.groupHeader}
                    onClick={() => toggleGroupExpand(g.label)}
                  >
                    <span
                      className={`${styles.checkbox} ${allSel ? styles.checked : someSel ? styles.indeterminate : ''}`}
                      onClick={e => toggleGroupSelect(g, e)}
                      title="Select all"
                    >
                      {allSel ? '✓' : someSel ? '–' : ''}
                    </span>
                    <span className={styles.groupLabel}>{g.label}</span>
                    <span className={styles.groupCount}>{selected}/{total}</span>
                    <span className={styles.groupChevron}>{expanded ? '▾' : '▸'}</span>
                  </div>

                  {/* Collapsible member list */}
                  {expanded && (
                    <ul className={styles.memberList}>
                      {members.map(opt => (
                        <li
                          key={opt}
                          className={`${styles.item} ${styles.memberItem}`}
                          onClick={() => toggle(opt)}
                        >
                          <span className={`${styles.checkbox} ${value.includes(opt) ? styles.checked : ''}`}>
                            {value.includes(opt) ? '✓' : ''}
                          </span>
                          <span className={styles.optLabel}>{opt}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}

            {/* Ungrouped options */}
            {filtered.filter(o => !groupedOptions.has(o)).map(opt => (
              <li key={opt} className={styles.item} onClick={() => toggle(opt)}>
                <span className={`${styles.checkbox} ${value.includes(opt) ? styles.checked : ''}`}>
                  {value.includes(opt) ? '✓' : ''}
                </span>
                <span className={styles.optLabel}>{opt}</span>
              </li>
            ))}

            {filtered.length === 0 && (
              <li className={styles.empty}>No matches</li>
            )}
          </ul>

          {/* Resize handle */}
          <div className={styles.resizeHandle} onMouseDown={startResize} title="Drag to resize" />
        </div>
      )}
    </div>
  )
}
