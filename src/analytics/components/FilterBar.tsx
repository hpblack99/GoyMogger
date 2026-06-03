import type { AnalyticsFilters } from '../lib/types'
import styles from './FilterBar.module.css'

interface Props {
  filters: AnalyticsFilters
  onChange: (f: AnalyticsFilters) => void
  customers: string[]
  salesReps: string[]
  branches: string[]
}

export default function FilterBar({ filters, onChange, customers, salesReps, branches }: Props) {
  const set = (key: keyof AnalyticsFilters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
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
      <label className={styles.field}>
        <span>Customer</span>
        <select value={filters.customer} onChange={set('customer')}>
          <option value="">All Customers</option>
          {customers.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <label className={styles.field}>
        <span>Sales Rep</span>
        <select value={filters.salesRep} onChange={set('salesRep')}>
          <option value="">All Reps</option>
          {salesReps.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>
      <label className={styles.field}>
        <span>Branch</span>
        <select value={filters.branch} onChange={set('branch')}>
          <option value="">All Branches</option>
          {branches.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
      </label>
    </div>
  )
}
