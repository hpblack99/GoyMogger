export type BlockType = 'chart' | 'table' | 'text'
export type ChartType = 'bar' | 'line' | 'area' | 'pie'

export interface SeriesConfig {
  key: string
  label: string
  color: string
}

export interface ChartBlockConfig {
  question:       string
  chartType:      ChartType
  xKey:           string
  series:         SeriesConfig[]
  showTrendLine:  boolean
  showDataLabels: boolean
  height:         number
}

export interface TableBlockConfig {
  question:   string
  columnKeys: string[]
  columns:    string[]
}

export interface TextBlockConfig {
  content: string
}

export type BlockConfig = ChartBlockConfig | TableBlockConfig | TextBlockConfig

export interface ReportBlock {
  id:         string
  report_id:  string
  position:   number
  block_type: BlockType
  title:      string
  sql_query:  string | null
  config:     BlockConfig
  created_at: string
  updated_at: string
}

export interface Report {
  id:          string
  user_id:     string
  title:       string
  description: string | null
  created_at:  string
  updated_at:  string
}

export interface ReportShare {
  id:                 string
  report_id:          string
  shared_by_user_id:  string
  shared_with_email:  string
  can_edit:           boolean
  created_at:         string
}

export const DEFAULT_COLORS = [
  '#22c55e','#06b6d4','#f59e0b','#a78bfa',
  '#f472b6','#fb923c','#34d399','#60a5fa',
]
