import { supabase } from '../../lib/supabase'

export interface CustomerGroup {
  id: string
  name: string
}

export interface CustomerRecord {
  id: string
  name: string
  is_rfp_customer: boolean
  parent_id: string | null
  group_id: string | null
  notes: string | null
}

export interface RfpBid {
  id: string
  customer_id: string
  description: string | null
  lanes: number | null
  estimated_revenue: number | null
  estimated_profit: number | null
  status: 'pending' | 'won' | 'lost' | 'declined'
  bid_date: string | null
  decision_date: string | null
  notes: string | null
  created_at: string
  // joined
  customer?: CustomerRecord
}

export async function fetchCustomers(): Promise<CustomerRecord[]> {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .order('name')
  if (error) throw error
  return data as CustomerRecord[]
}

export async function fetchCustomerGroups(): Promise<CustomerGroup[]> {
  const { data, error } = await supabase
    .from('customer_groups')
    .select('*')
    .order('name')
  if (error) throw error
  return data as CustomerGroup[]
}

export async function fetchRfpBids(): Promise<RfpBid[]> {
  const { data, error } = await supabase
    .from('rfp_bids')
    .select('*, customer:customers(id,name,is_rfp_customer,parent_id,group_id,notes)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as RfpBid[]
}

export async function upsertCustomer(
  data: Partial<CustomerRecord> & { name: string }
): Promise<CustomerRecord> {
  const { data: row, error } = await supabase
    .from('customers')
    .upsert(data, { onConflict: 'name' })
    .select()
    .single()
  if (error) throw error
  return row as CustomerRecord
}

export async function upsertCustomerGroup(name: string): Promise<CustomerGroup> {
  const { data, error } = await supabase
    .from('customer_groups')
    .insert({ name })
    .select()
    .single()
  if (error) throw error
  return data as CustomerGroup
}

export async function deleteCustomerGroup(id: string): Promise<void> {
  const { error } = await supabase
    .from('customer_groups')
    .delete()
    .eq('id', id)
  if (error) throw error
}

export async function upsertRfpBid(
  data: Partial<RfpBid> & { customer_id: string }
): Promise<RfpBid> {
  const { data: row, error } = await supabase
    .from('rfp_bids')
    .upsert(data)
    .select()
    .single()
  if (error) throw error
  return row as RfpBid
}

export async function deleteRfpBid(id: string): Promise<void> {
  const { error } = await supabase
    .from('rfp_bids')
    .delete()
    .eq('id', id)
  if (error) throw error
}

export async function syncCustomersFromLoads(): Promise<void> {
  const { error } = await supabase.rpc('sync_customers_from_loads')
  if (error) throw error
}
