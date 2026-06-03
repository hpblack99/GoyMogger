import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthGate'
import type { Report, ReportBlock } from '../lib/reportTypes'
import ReportBlockView from '../components/ReportBlockView'
import styles from './ReportEditorPage.module.css'

export default function ReportEditorPage() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [report, setReport] = useState<Report | null>(null)
  const [blocks, setBlocks] = useState<ReportBlock[]>([])
  const [loading, setLoading] = useState(true)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [canEdit, setCanEdit] = useState(false)

  useEffect(() => {
    if (!id) return
    Promise.all([
      supabase.from('reports').select('*').eq('id', id).single(),
      supabase.from('report_blocks').select('*').eq('report_id', id).order('position'),
      supabase.from('report_shares').select('can_edit').eq('report_id', id).eq('shared_with_email', user.email ?? '').maybeSingle(),
    ]).then(([{ data: r }, { data: b }, { data: share }]) => {
      if (!r) { navigate('/analytics/reports'); return }
      setReport(r as Report)
      setTitleDraft((r as Report).title)
      setBlocks((b as ReportBlock[]) ?? [])
      const isOwner = (r as Report).user_id === user.id
      setCanEdit(isOwner || (share?.can_edit ?? false))
      setLoading(false)
    })
  }, [id, user.id, user.email])

  const saveTitle = async () => {
    if (!report || titleDraft === report.title) { setEditingTitle(false); return }
    await supabase.from('reports').update({ title: titleDraft }).eq('id', report.id)
    setReport(r => r ? { ...r, title: titleDraft } : r)
    setEditingTitle(false)
  }

  const moveBlock = async (index: number, dir: -1 | 1) => {
    const next = index + dir
    if (next < 0 || next >= blocks.length) return
    const reordered = [...blocks]
    ;[reordered[index], reordered[next]] = [reordered[next], reordered[index]]
    const updated = reordered.map((b, i) => ({ ...b, position: i }))
    setBlocks(updated)
    await Promise.all(updated.map(b => supabase.from('report_blocks').update({ position: b.position }).eq('id', b.id)))
  }

  const deleteBlock = async (blockId: string) => {
    await supabase.from('report_blocks').delete().eq('id', blockId)
    setBlocks(b => b.filter(x => x.id !== blockId))
  }

  const updateBlock = (updated: ReportBlock) => {
    setBlocks(b => b.map(x => x.id === updated.id ? updated : x))
  }

  if (loading) return <div className={styles.loading}>Loading report…</div>
  if (!report) return null

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button className={styles.back} onClick={() => navigate('/analytics/reports')}>← Reports</button>
        <div className={styles.titleWrap}>
          {editingTitle && canEdit ? (
            <input
              className={styles.titleInput}
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={e => { if (e.key === 'Enter') saveTitle() }}
              autoFocus
            />
          ) : (
            <h1 className={styles.title} onClick={() => canEdit && setEditingTitle(true)} title={canEdit ? 'Click to rename' : undefined}>
              {report.title}
            </h1>
          )}
        </div>
        {!canEdit && <span className={styles.viewOnly}>View only</span>}
      </div>

      {blocks.length === 0 ? (
        <div className={styles.empty}>
          <p>This report has no blocks yet.</p>
          <p>Go to <strong>Brainstorm</strong> and save charts, tables, or explanations here.</p>
        </div>
      ) : (
        <div className={styles.blocks}>
          {blocks.map((block, i) => (
            <ReportBlockView
              key={block.id}
              block={block}
              canEdit={canEdit}
              onMoveUp={i > 0 ? () => moveBlock(i, -1) : undefined}
              onMoveDown={i < blocks.length - 1 ? () => moveBlock(i, 1) : undefined}
              onDelete={() => deleteBlock(block.id)}
              onUpdate={updateBlock}
            />
          ))}
        </div>
      )}
    </div>
  )
}
