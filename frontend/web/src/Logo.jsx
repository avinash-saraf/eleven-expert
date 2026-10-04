// Eleven Expert mark: two E's (expert + apprentice). A thin line leaves the expert E's
// middle arm, passes through a decision node, and lands in the apprentice E's spine:
// judgment captured, then transferred.
export function Mark({ height = 22, dark = true, className = '' }) {
  const ink = dark ? '#18181b' : '#ffffff'
  return (
    <svg viewBox="0 0 54 32" height={height} className={className} aria-label="Eleven Expert" role="img">
      <g fill="none" stroke={ink} strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 5H17M4 5V27M4 27H17M4 16H11" />
        <path d="M37 5H50M37 5V27M37 27H50M37 16H44" />
      </g>
      <path d="M11 16H37" stroke="#6d5efc" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="24" cy="16" r="3.2" fill="#6d5efc" />
    </svg>
  )
}

export default function Logo({ size = 22, text = true, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-3 ${className}`}>
      <Mark height={size} />
      {text && <span className="hidden whitespace-nowrap font-semibold sm:inline tracking-[0.24em]" style={{ fontSize: size * 0.62 }}>ELEVEN EXPERT</span>}
    </span>
  )
}
