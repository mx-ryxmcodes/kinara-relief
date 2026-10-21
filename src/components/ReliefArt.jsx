// Decorative artwork and icons. All original, drawn in SVG, and hidden from
// assistive tech except the hero scene, which carries a short description.

export function Sparkle({ size = 18, className = '' }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2.5c.5 4.8 2.7 7 9.5 9.5-6.8 2.5-9 4.7-9.5 9.5-.5-4.8-2.7-7-9.5-9.5C9.3 9.5 11.5 7.3 12 2.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' };

export const Icons = {
  tent: (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" {...stroke}>
      <path d="M3 20 12 4l9 16" /><path d="M9.5 20 12 14l2.5 6" /><path d="M2 20h20" />
    </svg>
  ),
  family: (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" {...stroke}>
      <circle cx="8" cy="7.5" r="2.6" /><circle cx="16.5" cy="9" r="2" /><path d="M3 20c0-3.5 2.2-6 5-6s5 2.5 5 6" /><path d="M14.5 14.4c2.5-.5 5.5 1 5.5 5.6" />
    </svg>
  ),
  drop: (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" {...stroke}>
      <path d="M12 3c3.5 4.2 6 7.2 6 10.5a6 6 0 0 1-12 0C6 10.200 8.500 7.200 12 3Z" /><path d="m9.500 14 1.800 1.800 3.200-3.600" />
    </svg>
  ),
  box: (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" {...stroke}>
      <path d="m3.500 7.500 8.500-4 8.500 4v9l-8.500 4-8.500-4v-9Z" /><path d="m3.500 7.500 8.500 4 8.500-4M12 11.500v9" />
    </svg>
  ),
  hand: (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" {...stroke}>
      <path d="M12 20s-7-4.200-7-9.500A3.800 3.800 0 0 1 12 8.600a3.800 3.800 0 0 1 7 1.900C19 15.800 12 20 12 20Z" />
    </svg>
  ),
};

// Soft wave strip used on top of the stat cards.
export function WaveBand({ tone = 'lavender' }) {
  const tones = {
    lavender: ['#e6dcf8', '#d3c3f1', '#f2ebfc'],
    peach: ['#fbe3d9', '#f5cbbd', '#fdf1ea'],
    mist: ['#e3e8f8', '#cfd7f1', '#f0f3fc'],
    blush: ['#f8e1ea', '#efc8d6', '#fcf0f4'],
    sand: ['#f4e9dc', '#ead8c3', '#faf4ec'],
  };
  const [a, b, c] = tones[tone] || tones.lavender;
  return (
    <svg className="kpi-wave" viewBox="0 0 300 90" preserveAspectRatio="none" aria-hidden="true">
      <rect width="300" height="90" fill={a} />
      <path d="M0 52C40 34 78 62 124 48S214 30 300 50V90H0Z" fill={b} opacity=".75" />
      <path d="M0 68C52 56 92 78 150 68S244 58 300 70V90H0Z" fill={c} opacity=".9" />
    </svg>
  );
}

// Dry reed plumes, the way dried flowers stand in a vase.
function Reeds({ x, base, tip, plumes = 16, lean = 0 }) {
  const items = [];
  for (let i = 0; i < plumes; i += 1) {
    const t = i / (plumes - 1);
    const px = x + lean * (1 - t) * 0.2 + (i % 2 ? 7 : -7) * (0.3 + t) * Math.sin(i * 1.7);
    const py = tip + t * 52 + (i % 3) * 3;
    items.push(<ellipse key={i} cx={px} cy={py} rx={3.200} ry={7.500} transform={`rotate(${(i % 2 ? 1 : -1) * (14 + i * 2)} ${px} ${py})`} fill={i % 3 === 0 ? '#fbf1e8' : '#f3e2d6'} opacity=".95" />);
  }
  return (
    <g>
      <path d={`M${x} ${base} C${x - 3 + lean} ${(base + tip) / 2} ${x + 2} ${tip + 60} ${x + lean * 0.2} ${tip + 20}`} stroke="#c3ad9e" strokeWidth="1.500" fill="none" />
      {items}
    </g>
  );
}

export function ArchScene() {
  return (
    <svg className="arch-art" viewBox="0 0 360 440" role="img" aria-label="Illustration of a relief tent on a raised platform above calm floodwater">
      <defs>
        <clipPath id="arch-clip"><path d="M0 440V180C0 80 80 0 180 0s180 80 180 180v260Z" /></clipPath>
        <linearGradient id="arch-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e4d9f8" /><stop offset=".55" stopColor="#efe0f1" /><stop offset="1" stopColor="#f9dcd5" />
        </linearGradient>
        <linearGradient id="arch-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d6c8f3" /><stop offset="1" stopColor="#ece3fa" />
        </linearGradient>
        <radialGradient id="arch-sun" cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#fff9f2" stopOpacity=".95" /><stop offset="1" stopColor="#fff9f2" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g clipPath="url(#arch-clip)">
        <rect width="360" height="440" fill="url(#arch-sky)" />
        <circle cx="255" cy="135" r="92" fill="url(#arch-sun)" />
        <path d="M0 0h96c-26 130 14 270-12 440H0Z" fill="#fff" opacity=".32" />
        <path d="M30 0h40c-18 130 12 250-8 440H8c14-190-18-300 22-440Z" fill="#fff" opacity=".22" />
        <path d="M0 300C70 268 126 292 196 276S322 270 360 292V440H0Z" fill="#dccff4" opacity=".75" />
        <path d="M0 338C52 326 92 350 142 338S252 324 302 338 342 346 360 336V440H0Z" fill="url(#arch-water)" />
        <ellipse cx="180" cy="378" rx="120" ry="9" fill="#9d86d6" opacity=".18" />
        <rect x="82" y="324" width="196" height="52" rx="8" fill="#f6efe9" />
        <rect x="82" y="324" width="196" height="9" rx="4.500" fill="#fffaf5" />
        <path d="M128 324 180 226l52 98Z" fill="#fcf6f0" />
        <path d="M180 226l52 98h-36Z" fill="#efddd3" />
        <path d="M164 324l16-52 16 52Z" fill="#cdb8ee" />
        <path d="M180 226v-22" stroke="#bda99a" strokeWidth="1.500" />
        <path d="M180 204l20 6-20 7Z" fill="#eca99c" />
        <path d="M0 392C64 380 118 402 180 392S300 382 360 396V440H0Z" fill="#bba3e8" opacity=".5" />
        <Reeds x={78} base={372} tip={150} lean={-8} />
        <Reeds x={104} base={372} tip={196} plumes={12} lean={6} />
        <Reeds x={292} base={372} tip={232} plumes={11} lean={-4} />
      </g>
      <path d="M1 440V180C1 81 81 1 180 1s179 80 179 179v260" fill="none" stroke="#cdbaf0" strokeWidth="2" />
    </svg>
  );
}

export function Seal() {
  return (
    <svg className="seal" viewBox="0 0 120 120" aria-hidden="true">
      <defs><path id="seal-circle" d="M60 60m-43 0a43 43 0 1 1 86 0a43 43 0 1 1-86 0" /></defs>
      <circle cx="60" cy="60" r="58" fill="#fffaf6" stroke="#e8dff5" />
      <circle cx="60" cy="60" r="30" fill="none" stroke="#efe7f8" />
      <text fontSize="8.500" letterSpacing="1.600" fill="#8a73b8" fontFamily="'DM Sans', sans-serif" fontWeight="500">
        <textPath href="#seal-circle" textLength="268" lengthAdjust="spacing">SINDH FLOOD RELIEF · COORDINATION DESK ·</textPath>
      </text>
      <g transform="translate(46 46)" color="#8a73b8"><Sparkle size={28} /></g>
    </svg>
  );
}
