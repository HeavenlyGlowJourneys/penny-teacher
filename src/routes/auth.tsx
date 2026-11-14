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

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in to Penny" },
      { name: "description", content: "Sign in to Penny — your AI teaching assistant." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"sign_in" | "sign_up" | "forgot">("sign_in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [resetEmail, setResetEmail] = useState("");

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);
    const msg =
      "Check your email — if an account exists for that address, we've sent a reset link. It may take a minute or two to arrive.";
    try {
      // Always show the same success message so we don't reveal whether the
      // address is registered. Log/network failures are still surfaced.
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) {
        const raw = error.message.toLowerCase();
        // Rate limits / misconfig should still be visible; "user not found"
        // style responses should not.
        if (raw.includes("rate") || raw.includes("network") || raw.includes("fetch")) {
          throw error;
        }
      }
      setInfoMsg(msg);
      toast.success(msg);
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Something went wrong";
      setErrorMsg(raw);
      toast.error(raw);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/dashboard", replace: true });
    });
  }, [navigate]);

  function friendlyError(raw: string): string {
    const m = raw.toLowerCase();
    if (m.includes("already registered") || m.includes("already been registered") || m.includes("user already")) {
      return "That email is already registered. Try signing in instead.";
    }
    if (m.includes("password") && (m.includes("short") || m.includes("at least") || m.includes("6"))) {
      return "Password must be at least 6 characters.";
    }
    if (m.includes("invalid") && m.includes("email")) return "That email address looks invalid.";
    if (m.includes("invalid login") || m.includes("invalid credentials")) {
      return "Email or password is incorrect.";
    }
    if (m.includes("email not confirmed")) return "Please verify your email before signing in.";
    if (m.includes("network") || m.includes("fetch")) return "Network error. Check your connection and try again.";
    return raw;
  }

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      if (mode === "sign_up") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          // The signup trigger gives every new account a 3-day trial with
          // full access — no plan to choose before reaching the app.
          options: { emailRedirectTo: window.location.origin + "/dashboard" },
        });
        if (error) throw error;

        if (data.session) {
          toast.success("Account created — your 3-day free trial has started.");
          navigate({ to: "/dashboard", replace: true });
          return;
        }
        // No session → verification required
        const msg = "Account created. Please check your email to verify your account before signing in.";
        setInfoMsg(msg);
        toast.success(msg);
        setMode("sign_in");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/dashboard", replace: true });
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Something went wrong";
      const friendly = friendlyError(raw);
      setErrorMsg(friendly);
      toast.error(friendly);
    } finally {
      setBusy(false);
    }
  }


  async function handleGoogle() {
    setBusy(true);
    setErrorMsg(null);
    try {
      // Supabase's own OAuth flow — not Lovable's, which only worked when
      // hosted through Lovable's infrastructure (the /~oauth/* routes it
      // depends on don't exist on this Cloudflare deployment).
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: window.location.origin + "/dashboard" },
      });
      if (error) {
        const msg = "Google sign-in failed. Please try again or use email.";
        setErrorMsg(msg);
        toast.error(msg);
      }
      // On success, Supabase redirects the browser to Google itself —
      // nothing left to do here.
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Google sign-in failed";
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
        <h1 className="font-display text-2xl font-semibold">
          {mode === "sign_in"
            ? "Sign in to Penny"
            : mode === "forgot"
              ? "Reset your password"
              : "Hi, I'm Penny"}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {mode === "sign_in"
            ? "Sign in to your teaching assistant."
            : mode === "forgot"
              ? "Enter your email and we'll send you a reset link."
              : "Let's get your classes set up."}
        </p>

        {mode !== "forgot" && (
          <>
            <Button
              type="button"
              variant="outline"
              className="w-full h-12 mt-5 rounded-xl text-base font-medium gap-3"
              onClick={handleGoogle}
              disabled={busy}
            >
              <GoogleIcon /> Continue with Google
            </Button>

            <div className="my-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">or</span>
              <div className="h-px flex-1 bg-border" />
            </div>
          </>
        )}

        {mode === "forgot" ? (
          <form onSubmit={handleForgot} className="space-y-3 mt-5">
            <div>
              <Label htmlFor="reset-email" className="text-xs uppercase tracking-wide text-muted-foreground">Email</Label>
              <Input id="reset-email" type="email" required value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} className="h-12 rounded-xl mt-1" placeholder="teacher@school.co.za" autoComplete="email" />
            </div>
            {errorMsg && (
              <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {errorMsg}
              </div>
            )}
            {infoMsg && (
              <div role="status" className="rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-foreground">
                {infoMsg}
              </div>
            )}
            <Button type="submit" className="w-full h-12 rounded-xl text-base mt-2" disabled={busy}>
              {busy ? "Sending…" : "Send reset link"}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleEmail} className="space-y-3">
            <div>
              <Label htmlFor="email" className="text-xs uppercase tracking-wide text-muted-foreground">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-12 rounded-xl mt-1" placeholder="teacher@school.co.za" autoComplete="email" />
            </div>
            <div>
              <Label htmlFor="password" className="text-xs uppercase tracking-wide text-muted-foreground">Password</Label>
              <div className="relative mt-1">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={mode === "sign_up" ? 8 : 6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 rounded-xl pr-12"
                  autoComplete={mode === "sign_in" ? "current-password" : "new-password"}
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
              {mode === "sign_up" && (
                <p className={`text-xs mt-1 ${password.length >= 8 ? "text-primary" : "text-muted-foreground"}`}>
                  {password.length >= 8 ? "✓" : "○"} At least 8 characters
                </p>
              )}
            </div>
            {errorMsg && (
              <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {errorMsg}
              </div>
            )}
            {infoMsg && (
              <div role="status" className="rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-foreground">
                {infoMsg}
              </div>
            )}
            {mode === "sign_in" && (
              <div className="text-right">
                <button
                  type="button"
                  onClick={() => {
                    setMode("forgot");
                    setErrorMsg(null);
                    setInfoMsg(null);
                    setResetEmail(email);
                  }}
                  className="text-sm text-primary hover:underline"
                >
                  Forgot your password?
                </button>
              </div>
            )}
            <Button type="submit" className="w-full h-12 rounded-xl text-base mt-2" disabled={busy}>
              {busy ? (mode === "sign_in" ? "Signing in…" : "Creating account…") : (mode === "sign_in" ? "Sign in" : "Create account")}
            </Button>
          </form>
        )}

        <button
          type="button"
          onClick={() => {
            setErrorMsg(null);
            setInfoMsg(null);
            if (mode === "forgot") setMode("sign_in");
            else setMode(mode === "sign_in" ? "sign_up" : "sign_in");
          }}
          className="mt-5 w-full text-center text-sm text-muted-foreground hover:text-foreground"
        >
          {mode === "sign_in"
            ? "New to Penny? Create an account"
            : mode === "forgot"
              ? "Back to sign in"
              : "Already have an account? Sign in"}
        </button>
      </div>
      <LegalFooter />
    </div>
  );
}


function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.75h3.57c2.08-1.92 3.28-4.74 3.28-8.07z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.75c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.12A6.96 6.96 0 0 1 5.5 12c0-.74.13-1.46.34-2.12V7.04H2.18A11 11 0 0 0 1 12c0 1.77.43 3.45 1.18 4.96l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.04l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" fill="#EA4335"/>
    </svg>
  );
}
