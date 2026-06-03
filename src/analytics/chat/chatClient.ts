import { supabase } from '../../lib/supabase'
import { buildSqlPrompt, buildSqlRetryPrompt, buildInterpretPrompt } from './prompts'

// Route through the Supabase edge function proxy to avoid CORS on Power Automate
const PROXY_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pa-chat-proxy`

export interface ChartSpec {
  type: 'line' | 'bar' | 'area' | 'pie'
  xKey: string
  series: { key: string; label?: string; color?: string }[]
  data: Record<string, unknown>[]
}

export interface TableSpec {
  columns: string[]
  rows: (string | number | null)[][]
}

export interface AssistantResult {
  answer: string
  chart: ChartSpec | null
  table: TableSpec | null
  sql?: string
}

// Strip ```json fences and parse, tolerating extra prose around the JSON.
function extractJson<T>(raw: string): T {
  let s = raw.trim()
  // Remove markdown code fences
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  // If there's leading/trailing prose, grab the outermost {...}
  const first = s.indexOf('{')
  const last = s.lastIndexOf('}')
  if (first > 0 || last < s.length - 1) {
    if (first !== -1 && last !== -1) s = s.slice(first, last + 1)
  }
  return JSON.parse(s) as T
}

// Call the single Power Automate flow with a prompt string, return the AI text.
async function runPrompt(prompt: string): Promise<string> {
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Power Automate returned ${res.status}. ${body.slice(0, 200)}`)
  }

  // PA Response shape varies — accept a raw string or common JSON wrappers.
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) {
    return (await res.text()).trim()
  }
  const json = await res.json()
  if (typeof json === 'string') return json
  return (
    json.result ?? json.text ?? json.output ?? json.answer ??
    json.response ?? json.body ?? JSON.stringify(json)
  )
}

// Destructive keyword guard — catches anything that isn't a plain SELECT.
const WRITE_PATTERN = /^\s*(insert|update|delete|drop|truncate|alter|create|replace|merge|grant|revoke|call|exec|execute|copy|vacuum|analyze|explain\s+analyze)\b/i

function assertReadOnly(sql: string) {
  if (WRITE_PATTERN.test(sql)) {
    throw new Error(`The assistant attempted a write operation which is not permitted.\n\nSQL blocked:\n${sql}`)
  }
  if (!/^\s*select\b/i.test(sql)) {
    throw new Error(`Only SELECT statements are allowed. The assistant returned:\n${sql}`)
  }
}

// Full round trip: question -> SQL -> data -> interpreted answer.
export async function askAssistant(
  question: string,
  history: string,
  onStage?: (stage: string) => void,
): Promise<AssistantResult> {
  // Phase 1 — generate SQL
  onStage?.('Thinking…')
  const sqlRaw = await runPrompt(buildSqlPrompt(question, history))
  let sql: string
  try {
    sql = extractJson<{ sql: string }>(sqlRaw).sql
  } catch {
    sql = sqlRaw.trim() // model may have returned bare SQL
  }
  assertReadOnly(sql)

  // Phase 2 — execute SQL via the safe read-only DB function (auto-retry once on error)
  onStage?.('Querying data…')
  let { data, error } = await supabase.rpc('chat_query', { query: sql })
  if (error) {
    onStage?.('Fixing query…')
    const fixedRaw = await runPrompt(buildSqlRetryPrompt(question, sql, error.message))
    let fixedSql: string
    try { fixedSql = extractJson<{ sql: string }>(fixedRaw).sql } catch { fixedSql = fixedRaw.trim() }
    assertReadOnly(fixedSql)
    sql = fixedSql
    const retry = await supabase.rpc('chat_query', { query: sql })
    data = retry.data
    error = retry.error
  }
  if (error) {
    throw new Error(`Query failed: ${error.message}\n\nSQL:\n${sql}`)
  }
  const rows = (data as unknown[]) ?? []

  // Phase 3 — interpret the result
  onStage?.('Interpreting…')
  const interpRaw = await runPrompt(buildInterpretPrompt(question, sql, rows))
  let result: AssistantResult
  try {
    result = extractJson<AssistantResult>(interpRaw)
  } catch {
    result = { answer: interpRaw.trim(), chart: null, table: null }
  }
  result.sql = sql
  return result
}
