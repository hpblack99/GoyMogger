import { useEffect, useState, useMemo } from 'react'
import { useAnalytics } from '../AnalyticsApp'
import {
  fetchCustomers,
  fetchRfpBids,
  upsertRfpBid,
  deleteRfpBid,
  type CustomerRecord,
  type RfpBid,
} from '../lib/customerApi'
import { fmt } from '../lib/calculations'
import styles from './RfpPage.module.css'

// ── Setup banner ──────────────────────────────────────────────────────────────

const MIGRATION_SQL = `-- Run in Supabase Dashboard → SQL Editor
CREATE TABLE IF NOT EXISTS customer_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  is_rfp_customer boolean NOT NULL DEFAULT false,
  parent_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  group_id uuid REFERENCES customer_groups(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
INSERT INTO customers (name)
SELECT DISTINCT customer_name FROM loads
WHERE customer_name IS NOT NULL AND customer_name <> ''
ON CONFLICT (name) DO NOTHING;
CREATE TABLE IF NOT EXISTS rfp_bids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  description text, lanes int,
  estimated_revenue numeric, estimated_profit numeric,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','won','lost','declined')),
  bid_date date, decision_date date, notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE customer_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfp_bids ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all" ON customer_groups FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON customers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON rfp_bids FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE OR REPLACE FUNCTION sync_customers_from_loads()
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  INSERT INTO customers (name)
  SELECT DISTINCT customer_name FROM loads
  WHERE customer_name IS NOT NULL AND customer_name <> ''
  ON CONFLICT (name) DO NOTHING;
$$;`

const NEEDS_SETUP_KEYWORDS = ['schema cache', 'does not exist', 'relation', '42P01', 'undefined', 'not found']

function SetupBanner({ error }: { error: string }) {
  const [copied, setCopied] = useState(false)
  const isSetup = NEEDS_SETUP_KEYWORDS.some(k => error.toLowerCase().includes(k.toLowerCase()))

  const copy = () => {
    navigator.clipboard.writeText(MIGRATION_SQL).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  if (!isSetup) return <div className={styles.errorBanner}>{error}</div>

  return (
    <div className={styles.setupBanner}>
      <div className={styles.setupTitle}>⚠ One-time database setup required</div>
      <p className={styles.setupText}>
        The RFP Tracker tables don't exist yet. Copy the SQL below and run it in your{' '}
        <strong>Supabase Dashboard → SQL Editor</strong>, then refresh this page.
      </p>
      <div className={styles.sqlBlock}>
        <pre className={styles.sqlPre}>{MIGRATION_SQL}</pre>
        <button className={styles.copyBtn} onClick={copy}>
          {copied ? '✓ Copied!' : 'Copy SQL'}
        </button>
      </div>
    </div>
  )
}

// ── BidModal ─────────────────────────────────────────────────────────────────

interface BidModalProps {
  bid: Partial<RfpBid>
  rfpCustomers: CustomerRecord[]
  saving: boolean
  onSave: (data: Partial<RfpBid> & { customer_id: string }) => void
  onDelete: (id: string) => void
  onClose: () => void
}

function BidModal({ bid, rfpCustomers, saving, onSave, onDelete, onClose }: BidModalProps) {
  const isNew = !bid.id

  const [customerId, setCustomerId] = useState(bid.customer_id ?? rfpCustomers[0]?.id ?? '')
  const [description, setDescription] = useState(bid.description ?? '')
  const [lanes, setLanes] = useState(bid.lanes != null ? String(bid.lanes) : '')
  const [estRevenue, setEstRevenue] = useState(bid.estimated_revenue != null ? String(bid.estimated_revenue) : '')
  const [estProfit, setEstProfit] = useState(bid.estimated_profit != null ? String(bid.estimated_profit) : '')
  const [status, setStatus] = useState<RfpBid['status']>(bid.status ?? 'pending')
  const [bidDate, setBidDate] = useState(bid.bid_date ?? '')
  const [decisionDate, setDecisionDate] = useState(bid.decision_date ?? '')
  const [notes, setNotes] = useState(bid.notes ?? '')

  function handleSave() {
    if (!customerId) return
    onSave({
      ...(bid.id ? { id: bid.id } : {}),
      customer_id: customerId,
      description: description || null,
      lanes: lanes !== '' ? Number(lanes) : null,
      estimated_revenue: estRevenue !== '' ? Number(estRevenue) : null,
      estimated_profit: estProfit !== '' ? Number(estProfit) : null,
      status,
      bid_date: bidDate || null,
      decision_date: decisionDate || null,
      notes: notes || null,
    })
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <span className={styles.modalTitle}>{isNew ? 'Add Bid' : 'Edit Bid'}</span>
          {!isNew && (
            <button className={styles.deleteLink} onClick={() => onDelete(bid.id!)}>
              Delete bid
            </button>
          )}
        </div>

        <div className={styles.form}>
          <div className={styles.formRow}>
            <label className={styles.formLabel}>Customer</label>
            <select
              className={styles.formSelect}
              value={customerId}
              onChange={e => setCustomerId(e.target.value)}
            >
              {rfpCustomers.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className={styles.formRow}>
            <label className={styles.formLabel}>Description</label>
            <input
              className={styles.formInput}
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Brief description of the bid"
            />
          </div>

          <div className={styles.formRow}>
            <label className={styles.formLabel}>Lanes</label>
            <input
              className={styles.formInput}
              type="number"
              value={lanes}
              onChange={e => setLanes(e.target.value)}
              placeholder="Number of lanes"
              min={0}
            />
          </div>

          <div className={styles.formRow}>
            <label className={styles.formLabel}>Est. Revenue</label>
            <input
              className={styles.formInput}
              type="number"
              value={estRevenue}
              onChange={e => setEstRevenue(e.target.value)}
              placeholder="0"
              min={0}
              step={1000}
            />
          </div>

          <div className={styles.formRow}>
            <label className={styles.formLabel}>Est. Profit</label>
            <input
              className={styles.formInput}
              type="number"
              value={estProfit}
              onChange={e => setEstProfit(e.target.value)}
              placeholder="0"
              min={0}
              step={1000}
            />
          </div>

          <div className={styles.formRow}>
            <label className={styles.formLabel}>Status</label>
            <select
              className={styles.formSelect}
              value={status}
              onChange={e => setStatus(e.target.value as RfpBid['status'])}
            >
              <option value="pending">Pending</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
              <option value="declined">Declined</option>
            </select>
          </div>

          <div className={styles.formRow}>
            <label className={styles.formLabel}>Bid Date</label>
            <input
              className={styles.formInput}
              type="date"
              value={bidDate}
              onChange={e => setBidDate(e.target.value)}
            />
          </div>

          <div className={styles.formRow}>
            <label className={styles.formLabel}>Decision Date</label>
            <input
              className={styles.formInput}
              type="date"
              value={decisionDate}
              onChange={e => setDecisionDate(e.target.value)}
            />
          </div>

          <div className={styles.formRow}>
            <label className={styles.formLabel}>Notes</label>
            <textarea
              className={styles.formTextarea}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder="Any additional notes…"
            />
          </div>
        </div>

        <div className={styles.formActions}>
          <button className={styles.cancelBtn} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className={styles.saveBtn} onClick={handleSave} disabled={saving || !customerId}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Status badge ──────────────────────────────────────────────────────────────

const badgeClass: Record<RfpBid['status'], string> = {
  pending: styles.badgePending,
  won: styles.badgeWon,
  lost: styles.badgeLost,
  declined: styles.badgeDeclined,
}

const statusLabel: Record<RfpBid['status'], string> = {
  pending: 'Pending',
  won: 'Won',
  lost: 'Lost',
  declined: 'Declined',
}

// ── RfpPage ───────────────────────────────────────────────────────────────────

export default function RfpPage() {
  const { allLoads } = useAnalytics()

  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [bids, setBids] = useState<RfpBid[]>([])
  const [loading, setLoading] = useState(true)
  const [editingBid, setEditingBid] = useState<Partial<RfpBid> | null>(null)
  const [savingBid, setSavingBid] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [c, b] = await Promise.all([fetchCustomers(), fetchRfpBids()])
      setCustomers(c)
      setBids(b)
    } catch (e: unknown) {
      const msg = (e instanceof Error ? e.message : (e as { message?: string })?.message) ?? 'Failed to load data'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const rfpCustomers = useMemo(
    () => customers.filter(c => c.is_rfp_customer === true),
    [customers]
  )

  // Build rollup stats for each RFP customer (parent + children)
  const rfpStats = useMemo(() => {
    return rfpCustomers
      .map(rfpC => {
        const children = customers.filter(c => c.parent_id === rfpC.id)
        const accountNames = new Set([rfpC.name, ...children.map(c => c.name)])
        const loads = allLoads.filter(l => l.customer_name && accountNames.has(l.customer_name))
        const loadCount = loads.length
        const totalRevenue = loads.reduce((s, l) => s + (l.load_revenue ?? 0), 0)
        const totalProfit = loads.reduce((s, l) => s + (l.load_profit ?? 0), 0)
        const margin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0
        return { rfpC, children, loadCount, totalRevenue, totalProfit, margin }
      })
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
  }, [rfpCustomers, customers, allLoads])

  async function handleSaveBid(data: Partial<RfpBid> & { customer_id: string }) {
    setSavingBid(true)
    try {
      await upsertRfpBid(data)
      await load()
      setEditingBid(null)
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : (e as { message?: string })?.message) ?? 'Failed to save bid')
    } finally {
      setSavingBid(false)
    }
  }

  async function handleDeleteBid(id: string) {
    if (!confirm('Delete this bid?')) return
    setSavingBid(true)
    try {
      await deleteRfpBid(id)
      await load()
      setEditingBid(null)
    } catch (e: unknown) {
      setError((e instanceof Error ? e.message : (e as { message?: string })?.message) ?? 'Failed to delete bid')
    } finally {
      setSavingBid(false)
    }
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>RFP Customer Tracker</h1>

      {error && <SetupBanner error={error} />}

      {/* ── Section 1: Pending Bids ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>Pending Bids</span>
          <button className={styles.addBtn} onClick={() => setEditingBid({})}>
            + Add Bid
          </button>
        </div>

        {loading ? (
          <div className={styles.loading}>Loading…</div>
        ) : bids.length === 0 ? (
          <div className={styles.empty}>No bids yet. Click "+ Add Bid" to get started.</div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Description</th>
                  <th className={styles.right}>Lanes</th>
                  <th className={styles.right}>Est Revenue</th>
                  <th className={styles.right}>Est Profit</th>
                  <th>Status</th>
                  <th>Bid Date</th>
                  <th>Decision Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {bids.map(bid => (
                  <tr key={bid.id}>
                    <td>{bid.customer?.name ?? '—'}</td>
                    <td>{bid.description ?? '—'}</td>
                    <td className={styles.right}>{bid.lanes != null ? fmt.num(bid.lanes) : '—'}</td>
                    <td className={styles.right}>{bid.estimated_revenue != null ? fmt.dollar(bid.estimated_revenue) : '—'}</td>
                    <td className={styles.right}>{bid.estimated_profit != null ? fmt.dollar(bid.estimated_profit) : '—'}</td>
                    <td>
                      <span className={`${styles.badge} ${badgeClass[bid.status]}`}>
                        {statusLabel[bid.status]}
                      </span>
                    </td>
                    <td>{bid.bid_date ? fmt.date(bid.bid_date) : '—'}</td>
                    <td>{bid.decision_date ? fmt.date(bid.decision_date) : '—'}</td>
                    <td>
                      <button
                        className={styles.actionBtn}
                        onClick={() => setEditingBid(bid)}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Section 2: RFP Account Performance ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>RFP Account Performance (All Time)</span>
        </div>

        {loading ? (
          <div className={styles.loading}>Loading…</div>
        ) : rfpCustomers.length === 0 ? (
          <div className={styles.empty}>
            No RFP customers configured. Mark customers as "Customer From Bid" in their settings.
          </div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Child Accounts</th>
                  <th className={styles.right}>Loads</th>
                  <th className={styles.right}>Revenue</th>
                  <th className={styles.right}>Gross Profit</th>
                  <th className={styles.right}>Margin</th>
                </tr>
              </thead>
              <tbody>
                {rfpStats.map(({ rfpC, children, loadCount, totalRevenue, totalProfit, margin }) => (
                  <tr key={rfpC.id}>
                    <td>{rfpC.name}</td>
                    <td>
                      {children.length > 0 ? (
                        <div className={styles.childList}>
                          {children.map(c => c.name).join(', ')}
                        </div>
                      ) : (
                        <span style={{ color: 'var(--color-neutral-400)', fontSize: '0.72rem' }}>—</span>
                      )}
                    </td>
                    <td className={styles.right}>{fmt.num(loadCount)}</td>
                    <td className={styles.right}>{fmt.dollar(totalRevenue)}</td>
                    <td className={styles.right}>{fmt.dollar(totalProfit)}</td>
                    <td className={styles.right}>{fmt.pct(margin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Bid Modal ── */}
      {editingBid !== null && (
        <BidModal
          bid={editingBid}
          rfpCustomers={rfpCustomers}
          saving={savingBid}
          onSave={handleSaveBid}
          onDelete={handleDeleteBid}
          onClose={() => setEditingBid(null)}
        />
      )}
    </div>
  )
}
