/** EduPhysics mark: a trajectory arc around a particle, in the platform's signal colours. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="5" fill="#38e1ff" />
      <path d="M3 21c5-12 21-17 26-9" fill="none" stroke="#fbbf24" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M29 12c-1 6-9 12-20 13" fill="none" stroke="#2dd4bf" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="2 3" />
    </svg>
  );
}
