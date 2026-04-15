export interface AddressInput {
  addressLine1?: string
  city?: string
  state?: string
  zip: string
  country?: string
}

export interface LineItem {
  id: string          // local React key only
  description: string
  weight: number | ''
  pieces: number | ''
  freightClass: string
  packagingType: string
  length: number | ''
  width: number | ''
  height: number | ''
  nmfc: string
  stackable: boolean
}

export type AccessorialKey =
  | 'residentialPickup'
  | 'liftgatePickup'
  | 'insidePickup'
  | 'limitedAccessPickup'
  | 'sortSegregatePickup'
  | 'residentialDelivery'
  | 'liftgateDelivery'
  | 'insideDelivery'
  | 'limitedAccessDelivery'
  | 'deliveryAppointment'
  | 'sortSegregateDelivery'
  | 'protectFromFreezing'
  | 'hazmat'

export const ACCESSORIAL_LABELS: Record<AccessorialKey, string> = {
  residentialPickup:      'Residential Pickup',
  liftgatePickup:         'Liftgate Pickup',
  insidePickup:           'Inside Pickup',
  limitedAccessPickup:    'Limited Access Pickup',
  sortSegregatePickup:    'Sort & Segregate Pickup',
  residentialDelivery:    'Residential Delivery',
  liftgateDelivery:       'Liftgate Delivery',
  insideDelivery:         'Inside Delivery',
  limitedAccessDelivery:  'Limited Access Delivery',
  deliveryAppointment:    'Delivery Appointment',
  sortSegregateDelivery:  'Sort & Segregate Delivery',
  protectFromFreezing:    'Protect From Freezing',
  hazmat:                 'Hazmat',
}

export type AccessorialState = Partial<Record<AccessorialKey, boolean>>

export const FREIGHT_CLASSES = [
  '50', '55', '60', '65', '70', '77.5',
  '85', '92.5', '100', '110', '125',
  '150', '175', '200', '250', '300', '400', '500',
]

export const PACKAGING_TYPES = [
  { value: 'PLT',     label: 'Pallet' },
  { value: 'SKID',    label: 'Skid' },
  { value: 'CRATE',   label: 'Crate' },
  { value: 'BOX',     label: 'Box' },
  { value: 'CARTON',  label: 'Carton' },
  { value: 'DRUM',    label: 'Drum' },
  { value: 'ROLL',    label: 'Roll' },
  { value: 'BALE',    label: 'Bale' },
  { value: 'BUNDLE',  label: 'Bundle' },
  { value: 'TOTE',    label: 'Tote' },
  { value: 'PIECES',  label: 'Pieces' },
  { value: 'LOOSE',   label: 'Loose' },
]

// ─── P44 response shapes ───────────────────────────────────────────────────────

export interface P44Charge {
  description: string
  amount: number
  currency: string
}

export interface P44RateQuote {
  capacityProviderName?: string
  capacityProviderCode?: string
  serviceLevel?: string
  transitDays?: number
  estimatedDeliveryDate?: string
  guaranteed?: boolean
  totalCost?: { amount: number; currency: string }
  charges?: P44Charge[]
  [key: string]: unknown
}

export interface QuoteResponse {
  success: boolean
  quoteId: string
  quoteDbId: string
  quotes: P44RateQuote[]
  timestamp: string
  error?: string
}
