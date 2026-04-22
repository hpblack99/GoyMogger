export interface ShipmentRow {
  rowIndex: number
  originZip: string
  destZip: string
  weight: number
  freightClass: string
  pieces?: number
  commodity?: string
}

export type QuoteStatus = 'pending' | 'processing' | 'complete' | 'error'

export interface QuoteResult extends ShipmentRow {
  status: QuoteStatus
  rate?: string
  transitDays?: string
  quoteNumber?: string
  error?: string
}

export type JobStatus = 'queued' | 'running' | 'complete' | 'error'

export interface Job {
  id: string
  status: JobStatus
  progress: number
  total: number
  results: QuoteResult[]
  error?: string
  createdAt: string
  completedAt?: string
}
