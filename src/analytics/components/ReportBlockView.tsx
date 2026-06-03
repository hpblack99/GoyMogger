import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { ReportBlock, ChartBlockConfig, TableBlockConfig, TextBlockConfig } from '../lib/reportTypes'
import { ChatChart, ChatTable } from '../chat/ChatViz'
import type { ChartSpec, TableSpec } from '../chat/chatClient'
import BlockEditPanel from './BlockEditPanel'
import styles from './ReportBlockView.module.css'

interface Props {
  block: ReportBlock
  canEdit: boolean
  onMoveUp?: () => void
  onMoveDown?: () => void
  onDelete: () => void
  onUpdate: (updated: ReportBlock) => void
}

export default function ReportBlockView({ block, canEdit, onMoveUp, onMoveDown, onDelete, onUpdate }: Props) {
  const [chartSpec, setChartSpec] = useState<ChartSpec | null>(null)
  const [tableSpec, setTableSpec] = useState<TableSpec | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (block.block_type === 'text' || !block.sql_query) return
    supabase.rpc('chat_query', { query: block.sql_query }).then(({ data, error: e }) => {
      if (e) { setError(e.message); return }
      const dbRows = (data as Record<string, unknown>[]) ?? []
      if (block.block_type === 'chart') {
        const cfg = block.config as ChartBlockConfig
        setChartSpec({ type: cfg.chartType, xKey: cfg.xKey, series: cfg.series, data: dbRows })
      } else if (block.block_type === 'table') {
        const cfg = block.config as TableBlockConfig
        const tableRows = dbRows.map(r => cfg.columnKeys.map(k => (r[k] ?? null) as string | number | null))
        setTableSpec({ columns: cfg.columns, rows: tableRows })
      }
    })
  }, [block.id, block.sql_query, block.block_type, block.config])

  const save = async (updated: ReportBlock) => {
    await supabase.from('report_blocks').update({
      title: updated.title,
      config: updated.config,
    }).eq('id', updated.id)
    onUpdate(updated)
    setEditing(false)
    // Refresh data if it's a chart/table
    if (updated.block_type !== 'text' && updated.sql_query) {
      const { data: refreshed } = await supabase.rpc('chat_query', { query: updated.sql_query })
      const dbRows = (refreshed as Record<string, unknown>[]) ?? []
      if (updated.block_type === 'chart') {
        const cfg = updated.config as ChartBlockConfig
        setChartSpec({ type: cfg.chartType, xKey: cfg.xKey, series: cfg.series, data: dbRows })
      } else if (updated.block_type === 'table') {
        const cfg = updated.config as TableBlockConfig
        const tableRows = dbRows.map(r => cfg.columnKeys.map(k => (r[k] ?? null) as string | number | null))
        setTableSpec({ columns: cfg.columns, rows: tableRows })
      }
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <span className={styles.blockTitle}>{block.title}</span>
        <div className={styles.actions}>
          {canEdit && onMoveUp && <button className={styles.iconBtn} onClick={onMoveUp} title="Move up">↑</button>}
          {canEdit && onMoveDown && <button className={styles.iconBtn} onClick={onMoveDown} title="Move down">↓</button>}
          {canEdit && <button className={styles.iconBtn} onClick={() => setEditing(e => !e)} title="Edit">✏️</button>}
          {canEdit && <button className={`${styles.iconBtn} ${styles.danger}`} onClick={onDelete} title="Delete">✕</button>}
        </div>
      </div>

      <div className={styles.content}>
        {block.block_type === 'text' && (
          <div className={styles.textBlock}>{(block.config as TextBlockConfig).content}</div>
        )}
        {block.block_type === 'chart' && (
          error ? <div className={styles.error}>{error}</div>
            : chartSpec ? <ChatChart spec={chartSpec} height={(block.config as ChartBlockConfig).height} />
              : <div className={styles.loading}>Loading…</div>
        )}
        {block.block_type === 'table' && (
          error ? <div className={styles.error}>{error}</div>
            : tableSpec ? <ChatTable spec={tableSpec} />
              : <div className={styles.loading}>Loading…</div>
        )}
      </div>

      {editing && canEdit && (
        <BlockEditPanel block={block} onSave={save} onCancel={() => setEditing(false)} />
      )}
    </div>
  )
}
