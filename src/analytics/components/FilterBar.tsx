import type { AnalyticsFilters } from '../lib/types'
import MultiSelect, { type OptionGroup } from './MultiSelect'
import styles from './FilterBar.module.css'

interface Props {
  filters: AnalyticsFilters
  onChange: (f: AnalyticsFilters) => void
  customers: string[]
  salesReps: string[]
  branches: string[]
  customerGroups?: OptionGroup[]
}

function iso(d: Date) { return d.toISOString().slice(0, 10) }

const PRESETS = [
  { label: 'Last Week',  days: 7   },
  { label: 'Last Month', days: 30  },
  { label: 'Last 3 Mo',  days: 90  },
  { label: 'Last 6 Mo',  days: 180 },
  { label: 'Last Year',  days: 365 },
]

export default function FilterBar({ filters, onChange, customers, salesReps, branches, customerGroups }: Props) {
  const set = (key: keyof AnalyticsFilters) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...filters, [key]: e.target.value })

  const applyPreset = (days: number) => {
    const to = new Date()
    const from = new Date()
    from.setDate(to.getDate() - days)
    onChange({ ...filters, dateFrom: iso(from), dateTo: iso(to) })
  }

  return (
    <div className={styles.bar}>
      <div className={styles.dateBlock}>
        <div className={styles.presetRow}>
          <span className={styles.presetLabel}>Quick select:</span>
          {PRESETS.map(p => (
            <button key={p.label} className={styles.presetBtn} onClick={() => applyPreset(p.days)}>
              {p.label}
            </button>
          ))}
        </div>
        <div className={styles.dateInputs}>
          <label className={styles.field}>
            <span>From</span>
            <input type="date" value={filters.dateFrom} onChange={set('dateFrom')} />
          </label>
          <label className={styles.field}>
            <span>To</span>
            <input type="date" value={filters.dateTo} onChange={set('dateTo')} />
          </label>
        </div>
      </div>
      <MultiSelect
        label="Customer"
        options={customers}
        value={filters.customers}
        onChange={v => onChange({ ...filters, customers: v })}
        allLabel="All Customers"
        groups={customerGroups}
      />
      <MultiSelect
        label="Sales Rep"
        options={salesReps}
        value={filters.salesReps}
        onChange={v => onChange({ ...filters, salesReps: v })}
        allLabel="All Reps"
      />
      <MultiSelect
        label="Branch"
        options={branches}
        value={filters.branches}
        onChange={v => onChange({ ...filters, branches: v })}
        allLabel="All Branches"
      />
    </div>
  )
}
