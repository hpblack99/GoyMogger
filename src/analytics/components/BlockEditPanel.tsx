import { useState } from 'react'
import type { ReportBlock, ChartBlockConfig, TableBlockConfig, TextBlockConfig, ChartType, SeriesConfig } from '../lib/reportTypes'
import { DEFAULT_COLORS } from '../lib/reportTypes'
import styles from './BlockEditPanel.module.css'

const CHART_TYPES: ChartType[] = ['bar', 'line', 'area', 'pie']

interface Props {
  block: ReportBlock
  onSave: (updated: ReportBlock) => void
  onCancel: () => void
}

export default function BlockEditPanel({ block, onSave, onCancel }: Props) {
  const [title, setTitle] = useState(block.title)
  const [config, setConfig] = useState(block.config)

  const chartCfg = config as ChartBlockConfig
  const tableCfg = config as TableBlockConfig
  const textCfg  = config as TextBlockConfig

  const patchChart = (patch: Partial<ChartBlockConfig>) => setConfig(c => ({ ...c, ...patch }))
  const patchSeries = (i: number, patch: Partial<SeriesConfig>) => {
    const series = [...chartCfg.series]
    series[i] = { ...series[i], ...patch }
    patchChart({ series })
  }

  const submit = () => onSave({ ...block, title, config })

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span>Edit Block</span>
        <button className={styles.closeBtn} onClick={onCancel}>✕</button>
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Title</label>
        <input className={styles.input} value={title} onChange={e => setTitle(e.target.value)} />
      </div>

      {block.block_type === 'text' && (
        <div className={styles.field}>
          <label className={styles.label}>Content</label>
          <textarea className={styles.textarea} rows={6} value={textCfg.content}
            onChange={e => setConfig({ ...textCfg, content: e.target.value })} />
        </div>
      )}

      {block.block_type === 'chart' && (
        <>
          <div className={styles.field}>
            <label className={styles.label}>Chart Type</label>
            <div className={styles.toggleRow}>
              {CHART_TYPES.map(t => (
                <button key={t} className={`${styles.toggleBtn} ${chartCfg.chartType === t ? styles.toggleActive : ''}`}
                  onClick={() => patchChart({ chartType: t })}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Height</label>
            <div className={styles.sliderRow}>
              <input type="range" min={160} max={520} step={20} value={chartCfg.height}
                onChange={e => patchChart({ height: Number(e.target.value) })} className={styles.slider} />
              <span className={styles.sliderVal}>{chartCfg.height}px</span>
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Options</label>
            <div className={styles.checkRow}>
              <label className={styles.check}>
                <input type="checkbox" checked={chartCfg.showTrendLine}
                  onChange={e => patchChart({ showTrendLine: e.target.checked })} />
                Trend line
              </label>
              <label className={styles.check}>
                <input type="checkbox" checked={chartCfg.showDataLabels}
                  onChange={e => patchChart({ showDataLabels: e.target.checked })} />
                Data labels
              </label>
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Series</label>
            <div className={styles.seriesList}>
              {chartCfg.series.map((s, i) => (
                <div key={s.key} className={styles.seriesRow}>
                  <input className={styles.colorSwatch} type="color"
                    value={s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]}
                    onChange={e => patchSeries(i, { color: e.target.value })} title="Color" />
                  <input className={styles.seriesLabel} value={s.label ?? s.key}
                    onChange={e => patchSeries(i, { label: e.target.value })} placeholder="Label" />
                  <span className={styles.seriesKey}>{s.key}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {block.block_type === 'table' && (
        <div className={styles.field}>
          <label className={styles.label}>Column Labels</label>
          <div className={styles.seriesList}>
            {tableCfg.columns.map((col, i) => (
              <div key={i} className={styles.seriesRow}>
                <span className={styles.seriesKey}>{tableCfg.columnKeys[i]}</span>
                <input className={styles.seriesLabel} value={col}
                  onChange={e => {
                    const columns = [...tableCfg.columns]
                    columns[i] = e.target.value
                    setConfig({ ...tableCfg, columns })
                  }} />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={styles.footer}>
        <button className={styles.saveBtn} onClick={submit}>Save</button>
        <button className={styles.cancelBtn} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
