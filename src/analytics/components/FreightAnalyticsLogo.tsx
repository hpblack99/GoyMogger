export default function FreightAnalyticsLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 400 90"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Freight Analytics by HankNet"
    >
      <defs>
        <linearGradient id="faG" x1="0.1" y1="1" x2="0.5" y2="0">
          <stop offset="0%"   stopColor="#15803d" />
          <stop offset="100%" stopColor="#4ade80" />
        </linearGradient>
      </defs>

      {/* ── Icon ──────────────────────────────────────────── */}

      {/* Vertical stroke of F */}
      <rect x="3"  y="5"  width="12" height="76" rx="2.5" fill="url(#faG)" />

      {/* Top horizontal bar */}
      <rect x="15" y="5"  width="36" height="12" rx="2.5" fill="url(#faG)" />

      {/* Middle horizontal bar */}
      <rect x="15" y="31" width="26" height="11" rx="2.5" fill="url(#faG)" />

      {/* Bar chart columns */}
      <rect x="16" y="60" width="8"  height="21" rx="1.5" fill="url(#faG)" />
      <rect x="26" y="51" width="8"  height="30" rx="1.5" fill="url(#faG)" />
      <rect x="36" y="42" width="8"  height="39" rx="1.5" fill="url(#faG)" />

      {/* Trend arrow line */}
      <line
        x1="12" y1="76"
        x2="51" y2="13"
        stroke="url(#faG)"
        strokeWidth="5"
        strokeLinecap="round"
      />
      {/* Arrowhead */}
      <polygon points="51,4 64,19 43,18" fill="url(#faG)" />

      {/* ── Text ──────────────────────────────────────────── */}

      <text
        x="82" y="52"
        fontFamily="'Segoe UI','Inter',system-ui,sans-serif"
        fontSize="34"
        fontWeight="800"
        letterSpacing="-0.5"
        fill="url(#faG)"
      >
        Freight Analytics
      </text>

      <text
        x="85" y="70"
        fontFamily="'Segoe UI','Inter',system-ui,sans-serif"
        fontSize="14"
        fontWeight="400"
        fill="rgba(255,255,255,0.7)"
        letterSpacing="0.3"
      >
        by HankNet
      </text>
    </svg>
  )
}
