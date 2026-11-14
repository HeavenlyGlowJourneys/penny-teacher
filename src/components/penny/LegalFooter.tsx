import { Link } from "@tanstack/react-router";

export function LegalFooter() {
  return (
    <footer className="mt-12 text-center text-xs text-muted-foreground">
      <div className="flex items-center justify-center gap-4">
        <Link to="/" className="hover:text-foreground transition-colors">
          Home
        </Link>
        <span className="text-border">·</span>
        <Link to="/pricing" className="hover:text-foreground transition-colors">
          Pricing
        </Link>
        <span className="text-border">·</span>
        <Link to="/faq" className="hover:text-foreground transition-colors">
          FAQ
        </Link>
        <span className="text-border">·</span>
        <Link to="/privacy" className="hover:text-foreground transition-colors">
          Privacy
        </Link>
        <span className="text-border">·</span>
        <Link to="/terms" className="hover:text-foreground transition-colors">
          Terms
        </Link>
      </div>
      <p className="mt-2">Penny — Your Teaching Assistant</p>
    </footer>
  );
}
