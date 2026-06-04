export default function FreightAnalyticsLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 340 96"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Freight Analytics by HankNet"
    >
      <defs>
        <linearGradient id="faGrad" x1="0.1" y1="1" x2="0.6" y2="0">
          <stop offset="0%"   stopColor="#16a34a" />
          <stop offset="100%" stopColor="#4ade80" />
        </linearGradient>
        <linearGradient id="faGradV" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%"   stopColor="#16a34a" />
          <stop offset="100%" stopColor="#4ade80" />
        </linearGradient>
      </defs>

      {/* ── FA Icon ─────────────────────────────────────── */}

      {/* Vertical stroke of the F */}
      <rect x="4" y="6" width="13" height="80" rx="3" fill="url(#faGrad)" />

      {/* Top horizontal bar of F */}
      <rect x="17" y="6" width="38" height="13" rx="3" fill="url(#faGrad)" />

      {/* Middle horizontal bar of F */}
      <rect x="17" y="33" width="27" height="11" rx="3" fill="url(#faGrad)" />

      {/* Bar chart columns (lower section of icon) */}
      <rect x="18" y="61" width="9" height="25" rx="2" fill="url(#faGradV)" />
      <rect x="29" y="51" width="9" height="35" rx="2" fill="url(#faGradV)" />
      <rect x="40" y="41" width="9" height="45" rx="2" fill="url(#faGradV)" />

      {/* Trend arrow — diagonal line from bottom-left to upper-right */}
      <line
        x1="14" y1="78"
        x2="54" y2="14"
        stroke="url(#faGrad)"
        strokeWidth="5.5"
        strokeLinecap="round"
      />
      {/* Arrowhead at the top right */}
      <polygon
        points="54,5  67,21  46,19"
        fill="url(#faGrad)"
      />

      {/* ── Text ────────────────────────────────────────── */}

      {/* "Freight Analytics" */}
      <text
        x="88" y="56"
        fontFamily="'Segoe UI','Inter',system-ui,sans-serif"
        fontSize="36"
        fontWeight="800"
        letterSpacing="-0.8"
        fill="url(#faGrad)"
      >
        Freight Analytics
      </text>

      {/* "by HankNet" */}
      <text
        x="91" y="76"
        fontFamily="'Segoe UI','Inter',system-ui,sans-serif"
        fontSize="15"
        fontWeight="400"
        fill="rgba(255,255,255,0.72)"
        letterSpacing="0.2"
      >
        by HankNet
      </text>
    </svg>
  )
}
