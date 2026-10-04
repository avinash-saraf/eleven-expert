// Animated face for the tutor. States: idle | thinking | speaking | listening.
// Swap this component for a video/avatar provider later; props stay the same.
export default function Face({ state = 'idle', size = 110 }) {
  const speaking = state === 'speaking'
  return (
    <div className="relative" style={{ width: size, height: size }}>
      {state !== 'idle' && <span className="ring absolute inset-0 rounded-full bg-glow/20" />}
      <svg viewBox="0 0 100 100" className="relative drop-shadow-[0_8px_24px_rgba(24,24,27,.12)]">
        <defs>
          <linearGradient id="skin" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f3c9a8" /><stop offset="1" stopColor="#d9a07c" />
          </linearGradient>
          <linearGradient id="hair" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2b2140" /><stop offset="1" stopColor="#45346a" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r="48" fill="#f1efec" />
        <path d="M18 52 C14 14 86 14 82 52 C80 34 66 26 50 26 C34 26 20 34 18 52Z" fill="url(#hair)" />
        <ellipse cx="50" cy="55" rx="28" ry="32" fill="url(#skin)" />
        <path d="M22 50 C22 22 78 22 78 50 C70 36 58 32 50 32 C42 32 30 36 22 50Z" fill="url(#hair)" />
        {/* eyes */}
        <g style={{ transformOrigin: '50px 52px' }} className="blink">
          <ellipse cx="38" cy={state === 'thinking' ? 50 : 52} rx="3" ry="3.4" fill="#2a1f2d" />
          <ellipse cx="62" cy={state === 'thinking' ? 50 : 52} rx="3" ry="3.4" fill="#2a1f2d" />
        </g>
        <path d="M31 44 Q38 41 45 44 M55 44 Q62 41 69 44" stroke="#3a2a40" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <path d="M50 54 L48 62 Q50 63.5 52 62" stroke="#c28a68" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        {/* mouth */}
        {speaking ? (
          <ellipse cx="50" cy="73" rx="7" ry="3" fill="#7a2f3e" className="talk" style={{ transformOrigin: '50px 73px' }} />
        ) : (
          <path d={state === 'listening' ? 'M42 72 Q50 78 58 72' : 'M43 73 Q50 76 57 73'} stroke="#7a2f3e" strokeWidth="2.2" fill="none" strokeLinecap="round" />
        )}
      </svg>
    </div>
  )
}
