import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowLeft, LogOut } from "lucide-react";
import type { ReactNode } from "react";
import { PennyWordmark } from "./Logo";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

interface AppShellProps {
  title?: string;
  back?: string | { to: string; params?: Record<string, string> };
  action?: ReactNode;
  children: ReactNode;
  showSignOut?: boolean;
}

export function AppShell({ title, back, action, children, showSignOut }: AppShellProps) {
  const router = useRouter();
  const navigate = useNavigate();

  async function signOut() {
    await supabase.auth.signOut();
    await router.invalidate();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen mx-auto max-w-md px-4 pb-28 pt-4 flex flex-col">
      <header className="flex items-center justify-between gap-2 mb-4">
        {back ? (
          typeof back === "string" ? (
            <Link
              to={back}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-card shadow-soft hover:bg-card-warm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background transition-colors"
              aria-label="Back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
          ) : (
            <Link
              to={back.to}
              params={back.params}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-card shadow-soft hover:bg-card-warm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background transition-colors"
              aria-label="Back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
          )
        ) : (
          <Link to="/" className="flex items-center">
            <PennyWordmark />
          </Link>
        )}
        <div className="flex items-center gap-2">
          {action}
          {showSignOut && (
            <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out">
              <LogOut className="h-5 w-5" />
            </Button>
          )}
        </div>
      </header>
      {title && (
        <h1 className="font-display text-[1.625rem] sm:text-3xl font-semibold mb-4 leading-[1.15] tracking-tight text-balance">{title}</h1>
      )}
      <main className="flex-1">{children}</main>
    </div>
  );
}
