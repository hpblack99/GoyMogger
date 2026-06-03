import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthGate'
import type { Report } from '../lib/reportTypes'
import styles from './ReportsPage.module.css'

interface ShareDialogProps {
  report: Report
  onClose: () => void
}

function ShareDialog({ report, onClose }: ShareDialogProps) {
  const { user } = useAuth()
  const [email, setEmail] = useState('')
  const [canEdit, setCanEdit] = useState(false)
  const [shares, setShares] = useState<{ id: string; shared_with_email: string; can_edit: boolean }[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('report_shares').select('id,shared_with_email,can_edit').eq('report_id', report.id).then(({ data }) => setShares(data ?? []))
  }, [report.id])

  const add = async () => {
    if (!email.trim()) return
    setLoading(true); setError('')
    const { error: e } = await supabase.from('report_shares').insert({
      report_id: report.id, shared_by_user_id: user.id,
      shared_with_email: email.trim().toLowerCase(), can_edit: canEdit,
    })
    if (e) setError(e.message)
    else {
      setShares(s => [...s, { id: Date.now().toString(), shared_with_email: email.trim().toLowerCase(), can_edit: canEdit }])
      setEmail('')
    }
    setLoading(false)
  }

  const remove = async (id: string) => {
    await supabase.from('report_shares').delete().eq('id', id)
    setShares(s => s.filter(x => x.id !== id))
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={e => e.stopPropagation()}>
        <div className={styles.dialogHeader}>
          <span>Share "{report.title}"</span>
          <button className={styles.dialogClose} onClick={onClose}>✕</button>
        </div>

        <div className={styles.shareAddRow}>
          <input className={styles.shareInput} placeholder="Email address…" value={email}
            onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
          <label className={styles.shareCheck}>
            <input type="checkbox" checked={canEdit} onChange={e => setCanEdit(e.target.checked)} />
            Can edit
          </label>
          <button className={styles.shareAddBtn} onClick={add} disabled={loading || !email.trim()}>Add</button>
        </div>
        {error && <div className={styles.shareError}>{error}</div>}

        {shares.length > 0 && (
          <div className={styles.shareList}>
            {shares.map(s => (
              <div key={s.id} className={styles.shareRow}>
                <span className={styles.shareEmail}>{s.shared_with_email}</span>
                <span className={styles.shareRole}>{s.can_edit ? 'Can edit' : 'View only'}</span>
                <button className={styles.shareRemove} onClick={() => remove(s.id)}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function ReportsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [myReports, setMyReports] = useState<Report[]>([])
  const [sharedReports, setSharedReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [shareTarget, setShareTarget] = useState<Report | null>(null)

  const load = async () => {
    setLoading(true)
    const [{ data: mine }, { data: shared }] = await Promise.all([
      supabase.from('reports').select('*').eq('user_id', user.id).order('updated_at', { ascending: false }),
      supabase.from('reports').select('*').neq('user_id', user.id).order('updated_at', { ascending: false }),
    ])
    setMyReports((mine as Report[]) ?? [])
    setSharedReports((shared as Report[]) ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [user.id])

  const createReport = async () => {
    const title = newTitle.trim() || 'Untitled Report'
    const { data } = await supabase.from('reports').insert({ user_id: user.id, title }).select('id').single()
    if (data) navigate(`/analytics/reports/${data.id}`)
  }

  const deleteReport = async (id: string) => {
    if (!confirm('Delete this report? This cannot be undone.')) return
    await supabase.from('reports').delete().eq('id', id)
    setMyReports(r => r.filter(x => x.id !== id))
  }

  const fmt = (s: string) => new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  if (loading) return <div className={styles.loading}>Loading reports…</div>

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Reports</h1>
          <p className={styles.sub}>Build and share AI-powered freight reports.</p>
        </div>
        <button className={styles.newBtn} onClick={() => setCreating(true)}>+ New Report</button>
      </div>

      {creating && (
        <div className={styles.createBar}>
          <input className={styles.createInput} placeholder="Report title…" value={newTitle}
            onChange={e => setNewTitle(e.target.value)} autoFocus onKeyDown={e => e.key === 'Enter' && createReport()} />
          <button className={styles.createConfirm} onClick={createReport}>Create</button>
          <button className={styles.createCancel} onClick={() => { setCreating(false); setNewTitle('') }}>Cancel</button>
        </div>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>My Reports</h2>
        {myReports.length === 0 ? (
          <div className={styles.empty}>No reports yet. Create one above or save from Brainstorm.</div>
        ) : (
          <div className={styles.grid}>
            {myReports.map(r => (
              <div key={r.id} className={styles.card}>
                <div className={styles.cardBody} onClick={() => navigate(`/analytics/reports/${r.id}`)}>
                  <div className={styles.cardTitle}>{r.title}</div>
                  {r.description && <div className={styles.cardDesc}>{r.description}</div>}
                  <div className={styles.cardDate}>Updated {fmt(r.updated_at)}</div>
                </div>
                <div className={styles.cardActions}>
                  <button className={styles.cardBtn} onClick={() => navigate(`/analytics/reports/${r.id}`)}>Open</button>
                  <button className={styles.cardBtn} onClick={() => setShareTarget(r)}>Share</button>
                  <button className={`${styles.cardBtn} ${styles.cardBtnDanger}`} onClick={() => deleteReport(r.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {sharedReports.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Shared with Me</h2>
          <div className={styles.grid}>
            {sharedReports.map(r => (
              <div key={r.id} className={styles.card}>
                <div className={styles.cardBody} onClick={() => navigate(`/analytics/reports/${r.id}`)}>
                  <div className={styles.cardTitle}>{r.title}</div>
                  {r.description && <div className={styles.cardDesc}>{r.description}</div>}
                  <div className={styles.cardDate}>Updated {fmt(r.updated_at)}</div>
                </div>
                <div className={styles.cardActions}>
                  <button className={styles.cardBtn} onClick={() => navigate(`/analytics/reports/${r.id}`)}>Open</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {shareTarget && <ShareDialog report={shareTarget} onClose={() => setShareTarget(null)} />}
    </div>
  )
}
