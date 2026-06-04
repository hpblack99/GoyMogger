// Compact schema description passed to the AI so it can write SQL.
export const DB_SCHEMA = `
TABLE loads (one row per freight invoice):
  invoice_num text (unique id), booked_date date,

  -- PEOPLE (individuals at FitzMark):
  sales_rep text        (FitzMark salesperson who owns the account),
  account_rep text      (FitzMark account manager),
  dispatch_rep text     (FitzMark dispatcher),
  quote_creator text    (who created the quote),
  branch_name text      (FitzMark office branch, e.g. "Fort Worth"),

  -- COMPANIES (external):
  customer_name text    (the shipping customer / company),

  booked_date date,
  scheduled_pickup_date date, actual_pickup_date date,
  scheduled_delivery_date date, actual_delivery_date date,
  pickup_location_name text, pickup_city text, pickup_state text, pickup_zip text,
  drop_location_name text, drop_city text, drop_state text, drop_zip text,
  line_item_count int, commodities text, tot_packages int, tot_weight numeric,
  total_linear_feet numeric, max_freight_class text,
  max_length numeric, max_width numeric, max_height numeric, is_vltl boolean,
  current_carrier_name text, quote_accepted_carrier_tariff_name text,
  service_level text, transit_days int,

  -- QUOTE columns (estimates only, do NOT use for actual KPIs):
  quote_orig_rev numeric, quote_original_exp numeric, quote_orig_profit numeric,
  quote_current_rev numeric, quote_current_exp numeric, quote_current_profit numeric,

  -- ACTUAL financials (always use these for revenue / profit / margin questions):
  load_revenue numeric        (actual billed revenue — this is THE revenue figure),
  load_carrier_expense numeric (carrier cost only),
  load_other_expense numeric  (other costs),
  load_profit numeric         (actual net profit = load_revenue - load_carrier_expense - load_other_expense — this is THE profit figure),

  load_accessorials text,
  cheapest_rev numeric, cheapest_exp numeric, cheapest_option_carrier text

TABLE load_charges (charge detail rows, many per invoice):
  invoice_num text (-> loads.invoice_num), type text, description text,
  units numeric, unit_rate numeric, subtotal numeric, charge_category text

DASHBOARD KPI DEFINITIONS (your answers must match these exactly):
  revenue       = SUM(load_revenue)
  profit        = SUM(load_profit)            ← NEVER compute as revenue - expenses; use load_profit directly
  margin %      = SUM(load_profit) / NULLIF(SUM(load_revenue), 0) * 100
  load count    = COUNT(*)
  rev per load  = SUM(load_revenue) / COUNT(*)
  profit/load   = SUM(load_profit) / COUNT(*)

POSTGRES RULES:
- date - date returns INTEGER days, NOT an interval. Use it directly as a number.
  WRONG: EXTRACT(DAY FROM CURRENT_DATE - some_date)
  RIGHT: (CURRENT_DATE - some_date) -- already an integer
- NEVER use INTERVAL for relative date ranges — use integer subtraction instead.
  This ensures your numbers match the dashboard exactly.
  WRONG: booked_date >= CURRENT_DATE - INTERVAL '1 month'
  RIGHT:  booked_date >= CURRENT_DATE - 30

DATE RANGE DEFINITIONS (must match these exactly — do not deviate):
  "today"          → booked_date = CURRENT_DATE
  "last week"      → booked_date >= CURRENT_DATE - 7
  "last month"     → booked_date >= CURRENT_DATE - 30
  "last 3 months"  → booked_date >= CURRENT_DATE - 90
  "last 6 months"  → booked_date >= CURRENT_DATE - 180
  "last year"      → booked_date >= CURRENT_DATE - 365
  "this month"     → booked_date >= DATE_TRUNC('month', CURRENT_DATE)
  "this year"      → booked_date >= DATE_TRUNC('year',  CURRENT_DATE)
  All ranges are inclusive of today: no upper bound needed unless specified.

- NEVER use quote_orig_profit, quote_current_profit, or any quote_* column when the question is about actual profit/revenue.
- "discount" = quote_orig_rev - load_revenue (when positive).
- Dates are ISO (YYYY-MM-DD). Always filter on booked_date for time ranges.
`.trim()

// ── Prompt builders ───────────────────────────────────────────────────────────

export function buildSqlPrompt(question: string, history: string): string {
  const today = new Date().toISOString().slice(0, 10)
  return `You are a PostgreSQL analyst for FitzMark, a freight brokerage. Today's date is ${today}. Write ONE read-only SQL query that answers the user's question against this schema:

${DB_SCHEMA}

${history ? `Recent conversation for context:\n${history}\n` : ''}
User question: "${question}"

RULES:
- Output a SINGLE SELECT statement only.
- NEVER use INSERT, UPDATE, DELETE, DROP, TRUNCATE, ALTER, CREATE, or any DDL/DML. Read-only only.
- Reference only the tables/columns above.
- For any revenue/profit/margin question ALWAYS use load_revenue and load_profit. NEVER use quote_orig_profit, quote_current_profit, or manually compute revenue - expenses. load_profit is the authoritative profit column.
- Always filter on booked_date for date ranges. Use integer subtraction: booked_date >= CURRENT_DATE - 30 (not INTERVAL).

NAME MATCHING (critical):
- People (sales reps, account reps, dispatchers) live in: sales_rep, account_rep, dispatch_rep, quote_creator.
  customer_name is a COMPANY, never a person's name.
- ALWAYS use fuzzy matching for any name. Split the name into words and match each word independently:
    WHERE sales_rep ILIKE '%kilian%' OR sales_rep ILIKE '%manns%'
  This handles typos, partial names, and name order variations.
- If the user mentions a "rep", "sales rep", "salesperson", or a person's first/last name,
  query sales_rep (and optionally account_rep). NEVER query customer_name for a person.
- For branch names: use ILIKE '%fort worth%' etc.
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

NAME MATCHING RULES:
- People live in sales_rep, account_rep, dispatch_rep — NOT customer_name (that's a company).
- Always match names with split-word ILIKE: WHERE sales_rep ILIKE '%first%' OR sales_rep ILIKE '%last%'

Return ONLY a corrected JSON object, no markdown:
{"sql": "<fixed SELECT statement>"}`
}

export function buildInterpretPrompt(question: string, sql: string, data: unknown[]): string {
  return `You are a data analyst answering a freight brokerage question. The user asked:
"${question}"

This SQL was run:
${sql}

It returned ${data.length} row(s):
${JSON.stringify(data).slice(0, 12000)}

Answer the question conversationally. Include a chart and/or table when it adds value.

CHART GUIDANCE:
- Use "area" for trends over time (weekly/monthly series) — best for revenue/profit over time
- Use "bar" for comparisons across categories (reps, customers, carriers) — best for rankings
- Use "line" for multiple trend series on the same axis
- Use "pie" only for share/composition with ≤8 slices
- xKey must be the field name (not display label) of the category/time axis
- series[].key must be the exact numeric field name from the SQL result
- series[].label is the human-readable display label (e.g. "Gross Profit", not "load_profit")
- data[] must use the exact field names from the SQL result rows
- Keep chart data under 50 points

TABLE GUIDANCE:
- Include a table whenever there are multiple rows of detail (rankings, lists, breakdowns)
- columns[] are display headers (e.g. "Sales Rep", "Revenue", "Profit", "Margin %")
- rows[][] must have values in the same order as columns
- Format numbers as plain numbers in rows (not strings with $ — the UI formats them)

ANSWER GUIDANCE:
- Lead with the key number(s) bolded using **value**
- Add 1-2 sentences of context or insight
- Use $ and % where relevant

Respond with ONLY a JSON object, no markdown fences:
{
  "answer": "<markdown with **bold** numbers>",
  "chart": null | { "type": "bar"|"line"|"area"|"pie", "xKey": "<field>", "series": [{"key": "<field>", "label": "<label>"}], "data": [{...}] },
  "table": null | { "columns": ["Col A", ...], "rows": [[val, ...], ...] }
}`
}
