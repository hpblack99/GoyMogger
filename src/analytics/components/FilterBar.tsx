import type { AnalyticsFilters } from '../lib/types'
import MultiSelect from './MultiSelect'
import styles from './FilterBar.module.css'

interface Props {
  filters: AnalyticsFilters
  onChange: (f: AnalyticsFilters) => void
  customers: string[]
  salesReps: string[]
  branches: string[]
}

export default function FilterBar({ filters, onChange, customers, salesReps, branches }: Props) {
  const set = (key: keyof AnalyticsFilters) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...filters, [key]: e.target.value })

  return (
    <div className={styles.bar}>
      <label className={styles.field}>
        <span>From</span>
        <input type="date" value={filters.dateFrom} onChange={set('dateFrom')} />
      </label>
      <label className={styles.field}>
        <span>To</span>
        <input type="date" value={filters.dateTo} onChange={set('dateTo')} />
      </label>
      <MultiSelect
        label="Customer"
        options={customers}
        value={filters.customers}
        onChange={v => onChange({ ...filters, customers: v })}
        allLabel="All Customers"
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
