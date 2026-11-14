import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { PennyWordmark } from "@/components/penny/Logo";
import { LegalFooter } from "@/components/penny/LegalFooter";

export function PrepCheckShell({
  children,
  title,
}: {
  children: ReactNode;
  title?: string;
}) {
  return (
    <div className="min-h-screen mx-auto max-w-2xl px-5 pb-16 pt-8 flex flex-col print:max-w-none print:px-8">
      <header className="mb-10 flex items-center justify-between gap-4 print:hidden">
        <Link to="/" className="inline-flex items-center">
          <PennyWordmark />
        </Link>
        {title ? (
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {title}
          </span>
        ) : null}
      </header>
      <main className="flex-1">{children}</main>
      <div className="print:hidden">
        <LegalFooter />
      </div>
    </div>
  );
}
