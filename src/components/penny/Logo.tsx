/** Stable production logos under /public — no Lovable CDN dependency. */
const LOGO_FULL = "/penny-logo.png?v=3";
const LOGO_ICON = "/penny-logo-icon.png?v=3";

export function PennyLogo({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <img
      src={LOGO_ICON}
      alt="Penny"
      className={`${className} object-contain`}
    />
  );
}

export function PennyWordmark() {
  return (
    <img
      src={LOGO_FULL}
      alt="Penny — Your Teaching Assistant"
      className="h-12 w-auto object-contain"
    />
  );
}
