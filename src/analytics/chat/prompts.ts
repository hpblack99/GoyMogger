// Compact schema description passed to the AI so it can write SQL.
export const DB_SCHEMA = `
TABLE loads (one row per freight invoice):
  invoice_num text (unique id), booked_date date,
  customer_name text, branch_name text, sales_rep text, account_rep text,
  dispatch_rep text, quote_creator text,
  scheduled_pickup_date date, actual_pickup_date date,
  scheduled_delivery_date date, actual_delivery_date date,
  pickup_location_name text, pickup_city text, pickup_state text, pickup_zip text,
  drop_location_name text, drop_city text, drop_state text, drop_zip text,
  line_item_count int, commodities text, tot_packages int, tot_weight numeric,
  total_linear_feet numeric, max_freight_class text,
  max_length numeric, max_width numeric, max_height numeric, is_vltl boolean,
  current_carrier_name text, quote_accepted_carrier_tariff_name text,
  service_level text, transit_days int,
  quote_orig_rev numeric, quote_original_exp numeric, quote_orig_profit numeric,
  quote_current_rev numeric, quote_current_exp numeric, quote_current_profit numeric,
  load_revenue numeric (actual revenue), load_carrier_expense numeric,
  load_other_expense numeric, load_profit numeric (actual profit),
  load_accessorials text,
  cheapest_rev numeric, cheapest_exp numeric, cheapest_option_carrier text

TABLE load_charges (charge detail rows, many per invoice):
  invoice_num text (-> loads.invoice_num), type text, description text,
  units numeric, unit_rate numeric, subtotal numeric, charge_category text

POSTGRES RULES (important):
- date - date returns INTEGER days, NOT an interval. Use it directly as a number.
  WRONG: EXTRACT(DAY FROM CURRENT_DATE - some_date)
  RIGHT: (CURRENT_DATE - some_date) -- already an integer
- To convert integer days to years: days / 365.0
- For interval arithmetic use INTERVAL: e.g. CURRENT_DATE - INTERVAL '90 days'
- margin % = load_profit / NULLIF(load_revenue, 0) * 100
- Use ILIKE '%term%' for fuzzy text matching (names vary in casing).
- "discount" = quote_orig_rev - load_revenue (when positive).
- Dates are ISO (YYYY-MM-DD). Filter booked_date for time ranges.
`.trim()

// ── Prompt builders ───────────────────────────────────────────────────────────

export function buildSqlPrompt(question: string, history: string): string {
  return `You are a PostgreSQL analyst for FitzMark, a freight brokerage. Write ONE read-only SQL query that answers the user's question against this schema:

${DB_SCHEMA}

${history ? `Recent conversation for context:\n${history}\n` : ''}
User question: "${question}"

RULES:
- Output a SINGLE SELECT statement only.
- NEVER use INSERT, UPDATE, DELETE, DROP, TRUNCATE, ALTER, CREATE, or any DDL/DML. Read-only only.
- Reference only the tables/columns above.
- Aggregate when the question implies totals/averages/rankings.
- Always alias computed columns with clear snake_case names.
- Never SELECT * on large tables; pick the columns you need.

Respond with ONLY a JSON object, no markdown fences:
{"sql": "<the SELECT statement>"}`
}

export function buildSqlRetryPrompt(question: string, badSql: string, dbError: string): string {
  return `You are a PostgreSQL analyst. Your previous query failed with an error. Fix it.

Original question: "${question}"

Failed SQL:
${badSql}

Database error:
${dbError}

${DB_SCHEMA}

POSTGRES RULES:
- date - date returns INTEGER days directly, not an interval. Never use EXTRACT(DAY FROM date - date).
- Use (date_col - other_date_col) as a plain integer for day counts.
- To annualize: integer_days / 365.0

Return ONLY a corrected JSON object, no markdown:
{"sql": "<fixed SELECT statement>"}`
}

export function buildInterpretPrompt(question: string, sql: string, data: unknown[]): string {
  return `You are a data analyst answering a freight brokerage question. The user asked:
"${question}"

This SQL was run:
${sql}

It returned ${data.length} row(s) of JSON data:
${JSON.stringify(data).slice(0, 12000)}

Interpret the data and answer the question conversationally. If a visualization helps, include a chart and/or table.

Respond with ONLY a JSON object, no markdown fences, in this exact shape:
{
  "answer": "<concise markdown answer, use $ and % where relevant>",
  "chart": null OR {
    "type": "line" | "bar" | "area" | "pie",
    "xKey": "<field name for x-axis / category>",
    "series": [{"key": "<numeric field>", "label": "<display label>"}],
    "data": [ { ...row objects using the field names... } ]
  },
  "table": null OR {
    "columns": ["Col A", "Col B"],
    "rows": [["v1", "v2"], ...]
  }
}
Keep chart data under 50 points. Prefer a chart for trends/comparisons, a table for detailed lists, both if useful.`
}
