import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PennyWordmark } from "@/components/penny/Logo";
import { LegalFooter } from "@/components/penny/LegalFooter";
import { toast } from "sonner";
import { Eye, EyeOff } from "lucide-react";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Reset your password — Penny" },
      { name: "description", content: "Set a new password for your Penny account." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Supabase-js parses the recovery tokens from the URL hash automatically
    // and emits a PASSWORD_RECOVERY event. We just need to confirm we have a
    // session before allowing the update.
    let settled = false;
    const markReady = () => {
      settled = true;
      setReady(true);
      setErrorMsg(null);
    };
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) markReady();
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) markReady();
    });
    const timer = window.setTimeout(() => {
      if (!settled) {
        setErrorMsg(
          "This reset link is invalid or has expired. Request a new one from the sign-in page.",
        );
      }
    }, 8000);
    return () => {
      settled = true;
      window.clearTimeout(timer);
      sub.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrorMsg(null);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      toast.success("Password updated. You're signed in.");
      setTimeout(() => navigate({ to: "/dashboard", replace: true }), 1200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not update password";
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen mx-auto max-w-md px-5 pt-10 pb-10 flex flex-col">
      <div className="flex justify-center mb-8">
        <PennyWordmark />
      </div>
      <div className="rounded-3xl bg-card p-6 shadow-warm">
        <h1 className="font-display text-2xl font-semibold">Set a new password</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Choose a strong password you'll remember.
        </p>

        {!ready ? (
          errorMsg ? (
            <div role="alert" className="mt-6 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {errorMsg}
            </div>
          ) : (
            <p className="mt-6 text-sm text-muted-foreground">
              Verifying your reset link…
            </p>
          )
        ) : done ? (
          <p className="mt-6 text-sm text-foreground">
            Password updated. Taking you to your dashboard…
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3 mt-5">
            <div>
              <Label htmlFor="new-password" className="text-xs uppercase tracking-wide text-muted-foreground">New password</Label>
              <div className="relative mt-1">
                <Input
                  id="new-password"
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 rounded-xl pr-12"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
              <p className={`text-xs mt-1 ${password.length >= 8 ? "text-primary" : "text-muted-foreground"}`}>
                {password.length >= 8 ? "✓" : "○"} At least 8 characters
              </p>
            </div>
            {errorMsg && (
              <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {errorMsg}
              </div>
            )}
            <Button type="submit" className="w-full h-12 rounded-xl text-base mt-2" disabled={busy || password.length < 8}>
              {busy ? "Updating…" : "Update password"}
            </Button>
          </form>
        )}
      </div>
      <LegalFooter />
    </div>
  );
}
