import { useEffect, useState } from 'react'
import styles from './CustomerSettingsModal.module.css'
import {
  fetchCustomers,
  fetchCustomerGroups,
  upsertCustomer,
  upsertCustomerGroup,
  type CustomerRecord,
  type CustomerGroup,
} from '../lib/customerApi'

interface Props {
  customerName: string
  onClose: () => void
}

export default function CustomerSettingsModal({ customerName, onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [customer, setCustomer] = useState<CustomerRecord | null>(null)
  const [groups, setGroups] = useState<CustomerGroup[]>([])
  const [allCustomers, setAllCustomers] = useState<CustomerRecord[]>([])

  // form state
  const [isRfp, setIsRfp] = useState(false)
  const [groupId, setGroupId] = useState<string>('')
  const [parentId, setParentId] = useState<string>('')
  const [notes, setNotes] = useState('')

  // new group inline
  const [newGroupName, setNewGroupName] = useState('')
  const [creatingGroup, setCreatingGroup] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [customers, grps] = await Promise.all([fetchCustomers(), fetchCustomerGroups()])
        if (cancelled) return
        setGroups(grps)
        setAllCustomers(customers)
        const found = customers.find(c => c.name.trim().toLowerCase() === customerName.trim().toLowerCase()) ?? null
        setCustomer(found)
        if (found) {
          setIsRfp(found.is_rfp_customer)
          setGroupId(found.group_id ?? '')
          setParentId(found.parent_id ?? '')
          setNotes(found.notes ?? '')
        }
      } catch (e) {
        if (!cancelled) setError(String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [customerName])

  async function handleCreateGroup() {
    if (!newGroupName.trim()) return
    setCreatingGroup(true)
    setError(null)
    try {
      const grp = await upsertCustomerGroup(newGroupName.trim())
      setGroups(prev => [...prev, grp].sort((a, b) => a.name.localeCompare(b.name)))
      setGroupId(grp.id)
      setNewGroupName('')
    } catch (e) {
      setError(String(e))
    } finally {
      setCreatingGroup(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await upsertCustomer({
        ...(customer ? { id: customer.id } : {}),
        name: customerName,
        is_rfp_customer: isRfp,
        group_id: groupId || null,
        parent_id: parentId || null,
        notes: notes || null,
      })
      onClose()
    } catch (e) {
      setError(String(e))
      setSaving(false)
    }
  }

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={styles.modal}>
        <div className={styles.title}>Customer Settings — {customerName}</div>

        {loading ? (
          <div className={styles.toggleLabel}>Loading…</div>
        ) : (
          <>
            {/* RFP Customer toggle */}
            <div className={styles.field}>
              <div className={styles.toggle}>
                <input
                  id="rfp-toggle"
                  type="checkbox"
                  className={styles.toggleInput}
                  checked={isRfp}
                  onChange={e => setIsRfp(e.target.checked)}
                />
                <label htmlFor="rfp-toggle" className={styles.toggleLabel}>
                  RFP Customer
                </label>
              </div>
            </div>

            {/* Customer Group */}
            <div className={styles.field}>
              <label className={styles.label}>Customer Group</label>
              <select
                className={styles.select}
                value={groupId}
                onChange={e => setGroupId(e.target.value)}
              >
                <option value="">No group</option>
                {groups.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
              <div className={styles.inlineRow}>
                <input
                  className={styles.inlineInput}
                  type="text"
                  placeholder="New group name…"
                  value={newGroupName}
                  onChange={e => setNewGroupName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreateGroup() }}
                />
                <button
                  className={styles.smallBtn}
                  onClick={handleCreateGroup}
                  disabled={creatingGroup || !newGroupName.trim()}
                >
                  {creatingGroup ? '…' : '+ New group'}
                </button>
              </div>
            </div>

            {/* Parent Account */}
            <div className={styles.field}>
              <label className={styles.label}>Parent Account</label>
              <select
                className={styles.select}
                value={parentId}
                onChange={e => setParentId(e.target.value)}
              >
                <option value="">No parent</option>
                {allCustomers
                  .filter(c => c.name !== customerName)
                  .map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
              </select>
            </div>

            {/* Notes */}
            <div className={styles.field}>
              <label className={styles.label}>Notes</label>
              <textarea
                className={styles.textarea}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Optional notes…"
              />
            </div>
          </>
        )}

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className={styles.saveBtn}
            onClick={handleSave}
            disabled={loading || saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
