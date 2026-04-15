import { useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  ACCESSORIAL_LABELS,
  FREIGHT_CLASSES,
  PACKAGING_TYPES,
  type AccessorialKey,
  type AccessorialState,
  type AddressInput,
  type LineItem,
  type P44RateQuote,
} from '../types/quote'
import styles from './QuotePage.module.css'

// ─── helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function defaultLineItem(): LineItem {
  return {
    id:           generateId(),
    description:  '',
    weight:       '',
    pieces:       1,
    freightClass: '70',
    packagingType:'PLT',
    length:       '',
    width:        '',
    height:       '',
    nmfc:         '',
    stackable:    false,
  }
}

function today(): string {
  return new Date().toISOString().split('T')[0]
}

function fmt(amount?: number, currency = 'USD'): string {
  if (amount == null) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

// ─── Address sub-form ──────────────────────────────────────────────────────────

interface AddressFormProps {
  label: string
  value: AddressInput
  onChange: (v: AddressInput) => void
}

function AddressForm({ label, value, onChange }: AddressFormProps) {
  const set = (field: keyof AddressInput) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      onChange({ ...value, [field]: e.target.value })

  return (
    <div className={styles.addressCard}>
      <h3 className={styles.addressLabel}>{label}</h3>
      <div className={styles.fieldRow}>
        <div className={styles.field}>
          <label className={styles.label}>ZIP Code <span className={styles.req}>*</span></label>
          <input
            className={styles.input}
            type="text"
            placeholder="e.g. 90210"
            value={value.zip}
            onChange={set('zip')}
            maxLength={10}
            required
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>City</label>
          <input
            className={styles.input}
            type="text"
            placeholder="City"
            value={value.city ?? ''}
            onChange={set('city')}
          />
        </div>
        <div className={styles.fieldSm}>
          <label className={styles.label}>State</label>
          <input
            className={styles.input}
            type="text"
            placeholder="CA"
            value={value.state ?? ''}
            onChange={set('state')}
            maxLength={2}
          />
        </div>
      </div>
      <div className={styles.field}>
        <label className={styles.label}>Address Line 1</label>
        <input
          className={styles.input}
          type="text"
          placeholder="Street address (optional)"
          value={value.addressLine1 ?? ''}
          onChange={set('addressLine1')}
        />
      </div>
    </div>
  )
}

// ─── Line item row ─────────────────────────────────────────────────────────────

interface LineItemRowProps {
  item: LineItem
  index: number
  canRemove: boolean
  onChange: (id: string, field: keyof LineItem, value: unknown) => void
  onRemove: (id: string) => void
}

function LineItemRow({ item, index, canRemove, onChange, onRemove }: LineItemRowProps) {
  const set = (field: keyof LineItem) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const raw = e.target.type === 'checkbox'
        ? (e.target as HTMLInputElement).checked
        : e.target.value
      onChange(item.id, field, raw)
    }

  return (
    <div className={styles.lineItem}>
      <div className={styles.lineItemHeader}>
        <span className={styles.lineItemNum}>Item {index + 1}</span>
        {canRemove && (
          <button type="button" className={styles.removeBtn} onClick={() => onRemove(item.id)}>
            Remove
          </button>
        )}
      </div>

      {/* Row 1: description + class + pkg type */}
      <div className={styles.lineRow}>
        <div className={`${styles.field} ${styles.grow}`}>
          <label className={styles.label}>Description <span className={styles.req}>*</span></label>
          <input
            className={styles.input}
            type="text"
            placeholder="e.g. Auto Parts"
            value={item.description}
            onChange={set('description')}
            required
          />
        </div>
        <div className={styles.fieldSm}>
          <label className={styles.label}>Freight Class <span className={styles.req}>*</span></label>
          <select className={styles.select} value={item.freightClass} onChange={set('freightClass')}>
            {FREIGHT_CLASSES.map((fc) => (
              <option key={fc} value={fc}>{fc}</option>
            ))}
          </select>
        </div>
        <div className={styles.fieldSm}>
          <label className={styles.label}>Package Type</label>
          <select className={styles.select} value={item.packagingType} onChange={set('packagingType')}>
            {PACKAGING_TYPES.map((pt) => (
              <option key={pt.value} value={pt.value}>{pt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Row 2: weight + pieces + dims */}
      <div className={styles.lineRow}>
        <div className={styles.fieldSm}>
          <label className={styles.label}>Weight (lbs) <span className={styles.req}>*</span></label>
          <input
            className={styles.input}
            type="number"
            min="1"
            placeholder="500"
            value={item.weight}
            onChange={set('weight')}
            required
          />
        </div>
        <div className={styles.fieldXs}>
          <label className={styles.label}>Pieces</label>
          <input
            className={styles.input}
            type="number"
            min="1"
            placeholder="1"
            value={item.pieces}
            onChange={set('pieces')}
          />
        </div>
        <div className={styles.fieldXs}>
          <label className={styles.label}>L (in)</label>
          <input
            className={styles.input}
            type="number"
            min="0"
            placeholder="48"
            value={item.length}
            onChange={set('length')}
          />
        </div>
        <div className={styles.fieldXs}>
          <label className={styles.label}>W (in)</label>
          <input
            className={styles.input}
            type="number"
            min="0"
            placeholder="40"
            value={item.width}
            onChange={set('width')}
          />
        </div>
        <div className={styles.fieldXs}>
          <label className={styles.label}>H (in)</label>
          <input
            className={styles.input}
            type="number"
            min="0"
            placeholder="48"
            value={item.height}
            onChange={set('height')}
          />
        </div>
        <div className={styles.fieldSm}>
          <label className={styles.label}>NMFC</label>
          <input
            className={styles.input}
            type="text"
            placeholder="e.g. 123456-01"
            value={item.nmfc}
            onChange={set('nmfc')}
          />
        </div>
        <div className={styles.checkboxField}>
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={item.stackable}
              onChange={set('stackable')}
            />
            Stackable
          </label>
        </div>
      </div>
    </div>
  )
}

// ─── Result card ───────────────────────────────────────────────────────────────

function ResultCard({ quote, rank }: { quote: P44RateQuote; rank: number }) {
  const amount   = quote.totalCost?.amount
  const currency = quote.totalCost?.currency ?? 'USD'

  return (
    <div className={`${styles.resultCard} ${rank === 1 ? styles.bestRate : ''}`}>
      {rank === 1 && <div className={styles.bestBadge}>Best Rate</div>}
      <div className={styles.resultCarrier}>
        {quote.capacityProviderName ?? quote.capacityProviderCode ?? 'Unknown Carrier'}
      </div>
      <div className={styles.resultRate}>{fmt(amount, currency)}</div>
      <div className={styles.resultMeta}>
        {quote.serviceLevel && (
          <span className={styles.tag}>{quote.serviceLevel}</span>
        )}
        {quote.guaranteed && (
          <span className={`${styles.tag} ${styles.tagGreen}`}>Guaranteed</span>
        )}
        {quote.transitDays != null && (
          <span className={styles.tag}>{quote.transitDays} day{quote.transitDays !== 1 ? 's' : ''}</span>
        )}
        {quote.estimatedDeliveryDate && (
          <span className={styles.tag}>Est. {quote.estimatedDeliveryDate}</span>
        )}
      </div>
      {quote.charges && quote.charges.length > 0 && (
        <details className={styles.chargeDetails}>
          <summary>Charge breakdown</summary>
          <table className={styles.chargeTable}>
            <tbody>
              {quote.charges.map((c, i) => (
                <tr key={i}>
                  <td>{c.description}</td>
                  <td className={styles.chargeAmt}>{fmt(c.amount, c.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function QuotePage() {
  const [origin, setOrigin] = useState<AddressInput>({ zip: '' })
  const [destination, setDestination] = useState<AddressInput>({ zip: '' })
  const [pickupDate, setPickupDate] = useState<string>(today())
  const [lineItems, setLineItems] = useState<LineItem[]>([defaultLineItem()])
  const [accessorials, setAccessorials] = useState<AccessorialState>({})
  const [hazmatClass, setHazmatClass] = useState('')
  const [unNumber, setUnNumber] = useState('')

  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<P44RateQuote[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // ── Line item handlers ───────────────────────────────────────────────────────
  const addLineItem = () => setLineItems((prev) => [...prev, defaultLineItem()])

  const removeLineItem = (id: string) =>
    setLineItems((prev) => prev.filter((li) => li.id !== id))

  const updateLineItem = (id: string, field: keyof LineItem, value: unknown) =>
    setLineItems((prev) =>
      prev.map((li) => (li.id === id ? { ...li, [field]: value } : li)),
    )

  // ── Accessorial handlers ─────────────────────────────────────────────────────
  const toggleAccessorial = (key: AccessorialKey) =>
    setAccessorials((prev) => ({ ...prev, [key]: !prev[key] }))

  // ── Submit ───────────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setResults(null)
    setLoading(true)

    try {
      const payload = {
        quoteId: generateId(),
        origin,
        destination,
        pickupDate,
        lineItems: lineItems.map((li) => ({
          description:   li.description,
          weight:        Number(li.weight),
          pieces:        Number(li.pieces) || 1,
          freightClass:  li.freightClass,
          packagingType: li.packagingType,
          length:        Number(li.length)  || 0,
          width:         Number(li.width)   || 0,
          height:        Number(li.height)  || 0,
          nmfc:          li.nmfc || undefined,
          stackable:     li.stackable,
        })),
        accessorials: Object.fromEntries(
          Object.entries(accessorials).filter(([, v]) => v),
        ),
        isHazmat:   accessorials.hazmat ?? false,
        hazmatClass: hazmatClass || undefined,
        unNumber:    unNumber    || undefined,
      }

      const { data, error: fnErr } = await supabase.functions.invoke('request-ltl-quote', {
        body: payload,
      })

      if (fnErr) throw new Error(fnErr.message)
      if (!data.success) throw new Error(data.error ?? 'Unknown error from quoting service')

      const sorted = [...(data.quotes as P44RateQuote[])].sort(
        (a, b) => (a.totalCost?.amount ?? Infinity) - (b.totalCost?.amount ?? Infinity),
      )
      setResults(sorted)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to retrieve quotes')
    } finally {
      setLoading(false)
    }
  }

  const hasHazmat = accessorials.hazmat === true

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <h1 className={styles.heroTitle}>LTL Freight Rate Quote</h1>
        <p className={styles.heroSub}>
          Get instant rates from top LTL carriers via Project44.
        </p>
      </div>

      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        {/* ── Addresses ── */}
        <section className={styles.section}>
          <div className={styles.addressGrid}>
            <AddressForm label="Origin" value={origin} onChange={setOrigin} />
            <AddressForm label="Destination" value={destination} onChange={setDestination} />
          </div>
        </section>

        {/* ── Pickup date ── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Pickup Date</h2>
          <div className={styles.fieldSm}>
            <label className={styles.label}>Date <span className={styles.req}>*</span></label>
            <input
              className={styles.input}
              type="date"
              value={pickupDate}
              min={today()}
              onChange={(e) => setPickupDate(e.target.value)}
              required
            />
          </div>
        </section>

        {/* ── Line items ── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Freight Details</h2>
          <div className={styles.lineItems}>
            {lineItems.map((item, i) => (
              <LineItemRow
                key={item.id}
                item={item}
                index={i}
                canRemove={lineItems.length > 1}
                onChange={updateLineItem}
                onRemove={removeLineItem}
              />
            ))}
          </div>
          <button type="button" className={styles.addItemBtn} onClick={addLineItem}>
            + Add Another Item
          </button>
        </section>

        {/* ── Accessorials ── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Accessorial Services</h2>
          <div className={styles.accessorialsGrid}>
            {(Object.keys(ACCESSORIAL_LABELS) as AccessorialKey[]).map((key) => (
              <label key={key} className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={accessorials[key] ?? false}
                  onChange={() => toggleAccessorial(key)}
                />
                {ACCESSORIAL_LABELS[key]}
              </label>
            ))}
          </div>

          {/* Hazmat details */}
          {hasHazmat && (
            <div className={`${styles.lineRow} ${styles.hazmatRow}`}>
              <div className={styles.field}>
                <label className={styles.label}>Hazmat Class</label>
                <input
                  className={styles.input}
                  type="text"
                  placeholder="e.g. 3"
                  value={hazmatClass}
                  onChange={(e) => setHazmatClass(e.target.value)}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>UN Number</label>
                <input
                  className={styles.input}
                  type="text"
                  placeholder="e.g. UN1234"
                  value={unNumber}
                  onChange={(e) => setUnNumber(e.target.value)}
                />
              </div>
            </div>
          )}
        </section>

        {/* ── Submit ── */}
        <div className={styles.submitRow}>
          <button type="submit" className={styles.submitBtn} disabled={loading}>
            {loading ? 'Getting Rates…' : 'Get Rates'}
          </button>
        </div>
      </form>

      {/* ── Error ── */}
      {error && (
        <div className={styles.errorBox}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* ── Results ── */}
      {results !== null && (
        <section className={styles.resultsSection}>
          <h2 className={styles.sectionTitle}>
            {results.length === 0
              ? 'No rates returned'
              : `${results.length} Rate${results.length !== 1 ? 's' : ''} Found`}
          </h2>
          {results.length > 0 && (
            <div className={styles.resultsGrid}>
              {results.map((q, i) => (
                <ResultCard key={i} quote={q} rank={i + 1} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
