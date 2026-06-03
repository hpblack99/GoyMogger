import { useState, useRef, useEffect, useCallback } from 'react'
import { askAssistant } from './chatClient'
import type { AssistantResult } from './chatClient'
import { ChatChart, ChatTable } from './ChatViz'
import styles from './ChatBot.module.css'

interface Message {
  id: string
  role: 'user' | 'assistant'
  text: string
  result?: AssistantResult
  error?: boolean
}

const WELCOME: Message = {
  id: 'welcome',
  role: 'assistant',
  text: "Hi! I'm your freight analytics assistant. Ask me anything about your loads — e.g. *\"Top 10 customers by profit this quarter\"* or *\"Which lanes have the worst margins?\"*",
}

// Render lightweight markdown (bold + italic + line breaks) safely.
function renderText(text: string) {
  const html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br/>')
  return <span dangerouslySetInnerHTML={{ __html: html }} />
}

export default function ChatBot() {
  const [open, setOpen]       = useState(false)
  const [messages, setMessages] = useState<Message[]>([WELCOME])
  const [input, setInput]     = useState('')
  const [busy, setBusy]       = useState(false)
  const [stage, setStage]     = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy, stage])

  const send = useCallback(async () => {
    const q = input.trim()
    if (!q || busy) return
    setInput('')
    const userMsg: Message = { id: `u${Date.now()}`, role: 'user', text: q }
    setMessages(m => [...m, userMsg])
    setBusy(true)
    setStage('Thinking…')

    // Build short text history for context (last 6 turns)
    const history = messages
      .filter(m => m.id !== 'welcome')
      .slice(-6)
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
      .join('\n')

    try {
      const result = await askAssistant(q, history, setStage)
      setMessages(m => [...m, {
        id: `a${Date.now()}`, role: 'assistant', text: result.answer || 'Done.', result,
      }])
    } catch (err) {
      setMessages(m => [...m, {
        id: `e${Date.now()}`, role: 'assistant', error: true,
        text: err instanceof Error ? err.message : String(err),
      }])
    } finally {
      setBusy(false)
      setStage('')
    }
  }, [input, busy, messages])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  return (
    <>
      {/* Floating launcher */}
      <button
        className={`${styles.launcher} ${open ? styles.launcherHidden : ''}`}
        onClick={() => setOpen(true)}
        aria-label="Open analytics assistant"
      >
        <span className={styles.launcherIcon}>✦</span>
      </button>

      {/* Panel */}
      <div className={`${styles.panel} ${open ? styles.panelOpen : ''}`}>
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            <span className={styles.headerIcon}>✦</span> Analytics Assistant
          </div>
          <button className={styles.closeBtn} onClick={() => setOpen(false)} aria-label="Close">✕</button>
        </div>

        <div className={styles.messages} ref={scrollRef}>
          {messages.map(m => (
            <div key={m.id} className={`${styles.msg} ${m.role === 'user' ? styles.msgUser : styles.msgAssistant} ${m.error ? styles.msgError : ''}`}>
              <div className={styles.msgText}>{renderText(m.text)}</div>
              {m.result?.chart && <ChatChart spec={m.result.chart} />}
              {m.result?.table && <ChatTable spec={m.result.table} />}
              {m.result?.sql && (
                <details className={styles.sqlDetails}>
                  <summary>View SQL</summary>
                  <pre className={styles.sqlPre}>{m.result.sql}</pre>
                </details>
              )}
            </div>
          ))}
          {busy && (
            <div className={`${styles.msg} ${styles.msgAssistant}`}>
              <div className={styles.stage}><span className={styles.dot} />{stage}</div>
            </div>
          )}
        </div>

        <div className={styles.inputRow}>
          <textarea
            className={styles.input}
            placeholder="Ask about your freight data…"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKey}
            rows={1}
            disabled={busy}
          />
          <button className={styles.sendBtn} onClick={send} disabled={busy || !input.trim()}>
            {busy ? '…' : '↑'}
          </button>
        </div>
      </div>
    </>
  )
}
