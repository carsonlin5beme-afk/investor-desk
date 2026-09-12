export function OrbitRefreshIcon({ className }: { className?: string }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M19.6 8.3A8.2 8.2 0 0 0 4.1 10M19.6 8.3l.2-4.2m-.2 4.2-4.1-.6" />
      <path d="M4.4 15.7A8.2 8.2 0 0 0 19.9 14M4.4 15.7l-.2 4.2m.2-4.2 4.1.6" />
      <ellipse
        cx="12"
        cy="12"
        rx="5.5"
        ry="2.2"
        transform="rotate(-30 12 12)"
        strokeWidth="1"
        opacity=".65"
      />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="16.7" cy="9.2" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function OrbitVisibilityIcon({ hidden }: { hidden: boolean }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {hidden ? (
        <>
          <path d="M9.4 5.9A11.4 11.4 0 0 1 12 5.6c5.8 0 9.5 6.4 9.5 6.4a18 18 0 0 1-3.5 4.1M14.6 18.1a11.4 11.4 0 0 1-2.6.3C6.2 18.4 2.5 12 2.5 12A18 18 0 0 1 6 7.9" />
          <path d="M10.6 8.7a3.6 3.6 0 0 1 4.7 4.7M13.4 15.3a3.6 3.6 0 0 1-4.7-4.7" />
          <path d="m3.5 3.5 17 17" />
        </>
      ) : (
        <>
          <path d="M2.5 12S6.2 5.6 12 5.6s9.5 6.4 9.5 6.4-3.7 6.4-9.5 6.4S2.5 12 2.5 12Z" />
          <ellipse
            cx="12"
            cy="12"
            rx="4.8"
            ry="2.5"
            transform="rotate(-35 12 12)"
            strokeWidth="1"
          />
          <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
          <circle cx="15.6" cy="9.4" r=".9" fill="currentColor" stroke="none" />
        </>
      )}
    </svg>
  );
}
