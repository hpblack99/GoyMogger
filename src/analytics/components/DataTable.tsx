import styles from './DataTable.module.css'

export interface Column<T> {
  key: string
  header: string
  render?: (row: T) => React.ReactNode
  align?: 'left' | 'right'
}

interface Props<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  emptyMessage?: string
  maxRows?: number
}

export default function DataTable<T extends object>({ columns, rows, rowKey, emptyMessage, maxRows }: Props<T>) {
  const visible = maxRows ? rows.slice(0, maxRows) : rows
  return (
    <div className={styles.wrapper}>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map(c => (
              <th key={c.key} className={c.align === 'right' ? styles.right : ''}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className={styles.empty}>
                {emptyMessage ?? 'No data'}
              </td>
            </tr>
          ) : (
            visible.map(row => (
              <tr key={rowKey(row)}>
                {columns.map(c => (
                  <td key={c.key} className={c.align === 'right' ? styles.right : ''}>
                    {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
      {maxRows && rows.length > maxRows && (
        <div className={styles.moreRow}>+{rows.length - maxRows} more rows</div>
      )}
    </div>
  )
}
