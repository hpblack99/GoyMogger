import { useState, useRef, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthGate'
import { askAssistant } from '../chat/chatClient'
import type { AssistantResult } from '../chat/chatClient'
import { ChatChart, ChatTable } from '../chat/ChatViz'
import type { Report } from '../lib/reportTypes'
import { DEFAULT_COLORS } from '../lib/reportTypes'
import styles from './BrainstormPage.module.css'

interface Message {
  id: string
  role: 'user' | 'assistant'
  text: string
  result?: AssistantResult
  error?: boolean
}

const WELCOME: Message = {
  id: 'welcome', role: 'assistant',
  text: "Ask me anything about your freight data. Charts, tables, and insights can be saved directly to a report using the **📌 Save** buttons.",
}

function renderMd(text: string) {
  const html = text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/\n/g,'<br/>')
  return <span dangerouslySetInnerHTML={{ __html: html }} />
}

// ── Save-to-report popup ──────────────────────────────────────────────────────
function SaveMenu({
  label, onSave,
}: {
  label: string
  onSave: (reportId: string | 'new', newTitle?: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [reports, setReports] = useState<Report[]>([])
  const [newTitle, setNewTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const [saved, setSaved] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { user } = useAuth()

  useEffect(() => {
    if (!open) return
    supabase.from('reports').select('id,title').eq('user_id', user.id).order('updated_at', { ascending: false }).then(({ data }) => setReports((data as Report[]) ?? []))
  }, [open, user.id])

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const save = async (reportId: string | 'new') => {
    await onSave(reportId, newTitle || 'New Report')
    setSaved(true)
    setOpen(false)
    setTimeout(() => setSaved(false), 2500)
  }

  if (saved) return <span className={styles.savedBadge}>✓ Saved</span>

  return (
    <div className={styles.saveWrap} ref={ref}>
      <button className={styles.saveBtn} onClick={() => setOpen(o => !o)}>📌 {label}</button>
      {open && (
        <div className={styles.saveMenu}>
          <div className={styles.saveMenuTitle}>Save to report</div>
          {reports.map(r => (
            <button key={r.id} className={styles.saveMenuItem} onClick={() => save(r.id)}>{r.title}</button>
          ))}
          <div className={styles.saveMenuDivider} />
          {creating ? (
            <div className={styles.saveNewRow}>
              <input className={styles.saveNewInput} placeholder="Report title…" value={newTitle} onChange={e => setNewTitle(e.target.value)} autoFocus onKeyDown={e => e.key === 'Enter' && save('new')} />
              <button className={styles.saveNewConfirm} onClick={() => save('new')}>Create</button>
            </div>
          ) : (
            <button className={styles.saveMenuNew} onClick={() => setCreating(true)}>➕ New report…</button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function BrainstormPage() {
  const { user } = useAuth()
  const [messages, setMessages] = useState<Message[]>([WELCOME])
  const [input, setInput]       = useState('')
  const [busy, setBusy]         = useState(false)
  const [stage, setStage]       = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  const send = useCallback(async () => {
    const q = input.trim()
    if (!q || busy) return
    setInput('')
    const userMsg: Message = { id: `u${Date.now()}`, role: 'user', text: q }
    setMessages(m => [...m, userMsg])
    setBusy(true)
    setStage('Thinking…')

    const history = messages.filter(m => m.id !== 'welcome').slice(-6)
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n')

    try {
      const result = await askAssistant(q, history, setStage)
      setMessages(m => [...m, { id: `a${Date.now()}`, role: 'assistant', text: result.answer || 'Done.', result }])
    } catch (err) {
      setMessages(m => [...m, { id: `e${Date.now()}`, role: 'assistant', error: true, text: err instanceof Error ? err.message : String(err) }])
    } finally { setBusy(false); setStage('') }
  }, [input, busy, messages])

  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }

  // Save a specific piece (chart / table / text) to a report
  const saveToReport = async (
    msg: Message,
    piece: 'chart' | 'table' | 'text',
    reportId: string | 'new',
    newTitle = 'New Report',
  ) => {
    let actualReportId = reportId
    if (reportId === 'new') {
      const { data } = await supabase.from('reports').insert({ user_id: user.id, title: newTitle }).select('id').single()
      actualReportId = data!.id
    }

    const r = msg.result!
    let block_type: string, sql_query: string | null, config: object, title: string

    if (piece === 'chart' && r.chart) {
      block_type = 'chart'; sql_query = r.sql ?? null; title = msg.text.slice(0, 80)
      config = {
        question: msg.text, chartType: r.chart.type,
        xKey: r.chart.xKey,
        series: r.chart.series.map((s, i) => ({ key: s.key, label: s.label ?? s.key, color: s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length] })),
        showTrendLine: false, showDataLabels: false, height: 280,
      }
    } else if (piece === 'table' && r.table) {
      block_type = 'table'; sql_query = r.sql ?? null; title = msg.text.slice(0, 80)
      config = { question: msg.text, columns: r.table.columns, columnKeys: r.table.columns }
    } else {
      block_type = 'text'; sql_query = null; title = msg.text.slice(0, 80)
      config = { content: r.answer }
    }

    // position = max existing + 1
    const { data: existing } = await supabase.from('report_blocks').select('position').eq('report_id', actualReportId).order('position', { ascending: false }).limit(1)
    const position = existing?.[0]?.position != null ? existing[0].position + 1 : 0

    await supabase.from('report_blocks').insert({ report_id: actualReportId, position, block_type, title, sql_query, config })
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Brainstorm</h1>
        <p className={styles.sub}>Chat with AI about your freight data. Save any chart, table, or insight to a report.</p>
      </div>

      <div className={styles.messages} ref={scrollRef}>
        {messages.map(msg => (
          <div key={msg.id} className={`${styles.msg} ${msg.role === 'user' ? styles.msgUser : styles.msgAssistant} ${msg.error ? styles.msgError : ''}`}>
            <div className={styles.msgText}>{renderMd(msg.text)}</div>

            {msg.result?.chart && (
              <div className={styles.vizSection}>
                <ChatChart spec={msg.result.chart} />
                <SaveMenu label="Save Chart" onSave={(rid, nt) => saveToReport(msg, 'chart', rid, nt)} />
              </div>
            )}
            {msg.result?.table && (
              <div className={styles.vizSection}>
                <ChatTable spec={msg.result.table} />
                <SaveMenu label="Save Table" onSave={(rid, nt) => saveToReport(msg, 'table', rid, nt)} />
              </div>
            )}
            {msg.result && (
              <div className={styles.saveRow}>
                <SaveMenu label="Save Explanation" onSave={(rid, nt) => saveToReport(msg, 'text', rid, nt)} />
                {msg.result.sql && (
                  <details className={styles.sqlDetails}>
                    <summary>View SQL</summary>
                    <pre className={styles.sqlPre}>{msg.result.sql}</pre>
                  </details>
                )}
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className={`${styles.msg} ${styles.msgAssistant}`}>
            <span className={styles.dot} /> {stage}
          </div>
        )}
      </div>

      <div className={styles.inputRow}>
        <textarea
          className={styles.input}
          placeholder="Ask about your freight data… (Enter to send, Shift+Enter for new line)"
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={onKey} rows={2} disabled={busy}
        />
        <button className={styles.sendBtn} onClick={send} disabled={busy || !input.trim()}>
          {busy ? '…' : '↑'}
        </button>
      </div>
    </div>
  )
}
