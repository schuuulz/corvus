// Corvus mark: a faceted raven head with a glowing emerald eye and a commit
// graph beside it. Mirrors app-icon.svg without its container. The facets
// are a few steps lighter than the icon's, because at tab-bar size the icon's
// shades vanish into the dark UI. Brand colours are fixed, not theme tokens.

// Slate shades from the darkest facet to the most lit one.
const SLATE = { shadow: "#334155", deep: "#3b4a60", body: "#475569", lit: "#526179", crown: "#64748b" };
const EDGE = "#94a3b8";
const EMERALD = "#10b981";
const EYE = "#00ff9d";
const VOID = "#0b0f12";

const FACETS: [points: string, fill: string][] = [
  ["15,32 22,17 34,13 28,30", SLATE.crown],
  ["34,13 40,20 28,30", SLATE.lit],
  ["40,20 58,30 42,26", SLATE.crown],
  ["42,26 58,30 40,31", SLATE.deep],
  ["28,30 40,20 42,26 40,31 38,40", SLATE.body],
  ["15,32 28,30 38,40 24,46", SLATE.deep],
  ["15,32 24,46 14,56", SLATE.shadow],
  ["24,46 38,40 35,56 14,56", SLATE.body],
];
const SILHOUETTE = "15,32 22,17 34,13 40,20 58,30 40,31 38,40 35,56 14,56";

export default function Logo({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="11 9 50 50" role="img" aria-label="Corvus">
      <defs>
        <filter id="corvus-glow" x="-200%" y="-200%" width="500%" height="500%">
          <feGaussianBlur stdDeviation="1.6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g fill="none" strokeLinecap="round" strokeWidth="1.2">
        <path d="M37 47 H49" stroke={SLATE.crown} />
        <path d="M49 42 C55 43 55 45 55 49" stroke={SLATE.crown} />
        <path d="M49 37 V53" stroke={EMERALD} />
      </g>
      <circle cx="55" cy="50" r="1.7" fill={VOID} stroke={EDGE} strokeWidth="1.1" />
      <circle cx="49" cy="53" r="1.9" fill={VOID} stroke={EMERALD} strokeWidth="1.2" />
      <circle cx="49" cy="37" r="2.1" fill={EMERALD} filter="url(#corvus-glow)" />
      {FACETS.map(([points, fill]) => (
        <polygon key={points} points={points} fill={fill} />
      ))}
      <polygon points={SILHOUETTE} fill="none" stroke={EDGE} strokeWidth="0.6" strokeLinejoin="round" />
      <circle cx="32" cy="22" r="2.6" fill={EYE} filter="url(#corvus-glow)" />
      <circle cx="32.5" cy="22" r="0.9" fill={VOID} />
    </svg>
  );
}
