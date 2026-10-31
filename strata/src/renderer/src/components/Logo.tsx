export function Logo({ size = 18 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="logo-mark" aria-hidden>
      <path d="M12 2.8 21 7.4 12 12 3 7.4Z" fill="var(--accent)" />
      <path d="M3 12l9 4.6 9-4.6" stroke="var(--accent)" strokeOpacity=".7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 16.6l9 4.6 9-4.6" stroke="var(--accent)" strokeOpacity=".4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
