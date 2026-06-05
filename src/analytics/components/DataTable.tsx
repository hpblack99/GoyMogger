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
  footerCells?: React.ReactNode[]   // one cell per column for a grand-total footer row
}

export default function DataTable<T extends object>({ columns, rows, rowKey, emptyMessage, maxRows, footerCells }: Props<T>) {
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
        {footerCells && (
          <tfoot>
            <tr className={styles.footerRow}>
              {footerCells.map((cell, i) => (
                <td key={i} className={columns[i]?.align === 'right' ? styles.right : ''}>
                  {cell}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
      {maxRows && rows.length > maxRows && (
        <div className={styles.moreRow}>+{rows.length - maxRows} more rows</div>
      )}
    </div>
  )
}
