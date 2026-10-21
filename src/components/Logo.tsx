// kraken-craft mark: a stylised commit graph whose branches curl like
// tentacles around a central node.
export default function Logo({ size = 64 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-label="kraken-craft">
      <defs>
        <linearGradient id="kc-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7c5cff" />
          <stop offset="1" stopColor="#21d4b4" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="22" r="12" fill="url(#kc-g)" />
      <path d="M22 30 C14 40 22 48 14 56" stroke="url(#kc-g)" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M32 34 L32 58" stroke="url(#kc-g)" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M42 30 C50 40 42 48 50 56" stroke="url(#kc-g)" strokeWidth="4" fill="none" strokeLinecap="round" />
      <circle cx="14" cy="56" r="4" fill="#7c5cff" />
      <circle cx="32" cy="58" r="4" fill="#4aa8d8" />
      <circle cx="50" cy="56" r="4" fill="#21d4b4" />
      <circle cx="28" cy="20" r="2.5" fill="#0d0f16" />
      <circle cx="36" cy="20" r="2.5" fill="#0d0f16" />
    </svg>
  );
}
