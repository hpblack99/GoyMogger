import { useId } from 'react'

interface Props {
  data: number[]
  color: string
  width?: number
  height?: number
}

/**
 * Lightweight inline-SVG sparkline — area fill + line + last-point dot.
 * Kept dependency-free so a dashboard can render many of them cheaply.
 */
export default function Sparkline({ data, color, width = 132, height = 34 }: Props) {
  const gradId = useId()
  if (!data || data.length < 2) {
    return <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden />
  }

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const stepX = width / (data.length - 1)
  const pad = 3 // keep the stroke off the top/bottom edges

  const pts = data.map((v, i) => {
    const x = i * stepX
    const y = pad + (height - pad * 2) * (1 - (v - min) / range)
    return [x, y] as const
  })

  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${line} L${width},${height} L0,${height} Z`
  const [lastX, lastY] = pts[pts.length - 1]

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"
      style={{ display: 'block' }} aria-hidden>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} stroke="none" />
      <path d={line} fill="none" stroke={color} strokeWidth={1.6}
        strokeLinejoin="round" strokeLinecap="round"
        vectorEffect="non-scaling-stroke" />
      <circle cx={lastX} cy={lastY} r={2.2} fill={color} />
    </svg>
  )
}
