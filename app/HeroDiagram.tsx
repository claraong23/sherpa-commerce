/**
 * Static architecture diagram for the landing hero.
 *
 * Explains the two-agent model at a glance: three merchant agents in their own
 * accents seal offers into an exchange, one customer agent evaluates them, and
 * Visa authorizes the result.
 *
 * Deliberately static. `/customer` is the live, event-driven visualization —
 * if this implied running state it would compete with the real thing.
 */
export function HeroDiagram({ className }: { className?: string }) {
  const merchants = [
    { x: 60, label: 'Sherpa', hue: 220 },
    { x: 200, label: 'Bizgram', hue: 178 },
    { x: 340, label: 'Challenger', hue: 340 },
  ]

  return (
    <svg
      viewBox="0 0 400 340"
      className={className}
      role="img"
      aria-label="Three merchant agents seal offers into an exchange; a customer agent evaluates them and Visa authorizes the purchase."
    >
      <defs>
        <linearGradient id="hd-exchange" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="hsl(220 70% 62%)" />
          <stop offset="50%" stopColor="hsl(178 62% 48%)" />
          <stop offset="100%" stopColor="hsl(340 88% 66%)" />
        </linearGradient>
        <filter id="hd-soft" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#171c28" floodOpacity="0.10" />
        </filter>
      </defs>

      {/* merchant agent nodes */}
      {merchants.map((m) => (
        <g key={m.label} filter="url(#hd-soft)">
          <rect
            x={m.x - 46}
            y={14}
            width={92}
            height={52}
            rx={13}
            fill="#ffffff"
            stroke={`hsl(${m.hue} 52% 78%)`}
            strokeWidth="1.2"
          />
          <rect x={m.x - 46} y={14} width={92} height={3.5} rx={1.75} fill={`hsl(${m.hue} 66% 60%)`} />
          <circle cx={m.x - 30} cy={44} r={4.5} fill={`hsl(${m.hue} 66% 60%)`} />
          <text
            x={m.x - 19}
            y={47}
            fontSize="11"
            fontWeight="600"
            fill="#384056"
            fontFamily="ui-sans-serif, system-ui, sans-serif"
          >
            {m.label}
          </text>
          <text
            x={m.x - 19}
            y={35}
            fontSize="7.5"
            fill="#9aa4b8"
            letterSpacing="0.08em"
            fontFamily="ui-sans-serif, system-ui, sans-serif"
          >
            AGENT
          </text>
        </g>
      ))}

      {/* sealed offers descending into the exchange */}
      {merchants.map((m) => (
        <g key={`l-${m.label}`}>
          <path
            d={`M ${m.x} 66 L ${m.x} 92 Q ${m.x} 104 ${m.x < 200 ? m.x + 12 : m.x > 200 ? m.x - 12 : m.x} 104 L 200 104`}
            fill="none"
            stroke={`hsl(${m.hue} 55% 76%)`}
            strokeWidth="1.4"
            strokeDasharray="4 4"
          />
          <rect
            x={m.x - 15}
            y={72}
            width={30}
            height={13}
            rx={6.5}
            fill={`hsl(${m.hue} 82% 96%)`}
            stroke={`hsl(${m.hue} 55% 82%)`}
            strokeWidth="0.9"
          />
          <text
            x={m.x}
            y={81.5}
            fontSize="6.5"
            fontWeight="700"
            textAnchor="middle"
            fill={`hsl(${m.hue} 48% 40%)`}
            letterSpacing="0.05em"
            fontFamily="ui-sans-serif, system-ui, sans-serif"
          >
            SEALED
          </text>
        </g>
      ))}

      {/* the exchange */}
      <g filter="url(#hd-soft)">
        <rect x={58} y={112} width={284} height={40} rx={20} fill="#ffffff" stroke="#dbe1ed" strokeWidth="1.2" />
        <rect x={70} y={129} width={260} height={5} rx={2.5} fill="url(#hd-exchange)" opacity="0.9" />
        <text
          x={200}
          y={125}
          fontSize="8"
          fontWeight="700"
          textAnchor="middle"
          fill="#4e5871"
          letterSpacing="0.12em"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
          SEALED OFFER EXCHANGE
        </text>
        <text
          x={200}
          y={147}
          fontSize="7.5"
          textAnchor="middle"
          fill="#9aa4b8"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
          no merchant sees another&apos;s offer
        </text>
      </g>

      <path d="M 200 152 L 200 176" stroke="#c2cad9" strokeWidth="1.4" strokeDasharray="4 4" fill="none" />

      {/* customer agent */}
      <g filter="url(#hd-soft)">
        <rect x={96} y={176} width={208} height={62} rx={15} fill="#ffffff" stroke="#c6d4f2" strokeWidth="1.4" />
        <rect x={96} y={176} width={208} height={3.5} rx={1.75} fill="hsl(220 66% 62%)" />
        <text
          x={200}
          y={198}
          fontSize="11.5"
          fontWeight="700"
          textAnchor="middle"
          fill="#171c28"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
          Customer agent
        </text>
        {['hard filter', 'facts', 'scoring'].map((t, i) => (
          <g key={t}>
            <rect x={110 + i * 63} y={208} width={57} height={17} rx={8.5} fill="#f4f7fb" stroke="#dbe1ed" strokeWidth="0.9" />
            <text
              x={138.5 + i * 63}
              y={219.5}
              fontSize="7.5"
              textAnchor="middle"
              fill="#4e5871"
              fontFamily="ui-sans-serif, system-ui, sans-serif"
            >
              {t}
            </text>
          </g>
        ))}
      </g>

      <path d="M 200 238 L 200 262" stroke="#c2cad9" strokeWidth="1.4" strokeDasharray="4 4" fill="none" />

      {/* Visa authorization */}
      <g filter="url(#hd-soft)">
        <rect x={112} y={262} width={176} height={46} rx={14} fill="#1a1f71" />
        <text
          x={200}
          y={280}
          fontSize="10.5"
          fontWeight="700"
          textAnchor="middle"
          fill="#ffffff"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
          Payment Instruction
        </text>
        <text
          x={200}
          y={295}
          fontSize="7.5"
          textAnchor="middle"
          fill="#ffffff"
          opacity="0.72"
          letterSpacing="0.05em"
          fontFamily="ui-sans-serif, system-ui, sans-serif"
        >
          merchant · amount · expiry · hash
        </text>
      </g>

      <circle cx={200} cy={322} r={5.5} fill="#1bc0ba" />
      <path d="M 197.4 322 l 1.9 1.9 l 3.4 -3.9" stroke="#ffffff" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
