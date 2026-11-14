import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CalendarRange, CreditCard, Mail, ShieldCheck, FileText, ChevronRight, Sliders } from "lucide-react";
import { AppShell } from "@/components/penny/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCurrentAcademicYear } from "@/hooks/use-academic-year";
import { useSubscription, PLAN_LABELS } from "@/hooks/use-subscription";
import { teacherDisplayName, updateTeacherDisplayName } from "@/lib/teacher-display-name";
import { PRODUCT } from "@/lib/product-knowledge";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings/")({
  head: () => ({ meta: [{ title: "Settings – Penny" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user } = Route.useRouteContext();
  const router = useRouter();
  const { current } = useCurrentAcademicYear();
  const sub = useSubscription();

  const [name, setName] = useState(() => teacherDisplayName(user));
  const [saving, setSaving] = useState(false);
  const dirty = name.trim() !== teacherDisplayName(user);

  useEffect(() => {
    setName(teacherDisplayName(user));
  }, [user]);

  async function saveName() {
    if (!dirty) return;
    setSaving(true);
    try {
      const saved = await updateTeacherDisplayName(name);
      setName(saved);
      await router.invalidate();
      toast.success("Name updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update name");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell back="/dashboard" title="Settings">
      <div className="space-y-4 pb-12">
        <Section title="Academic year">
          <Row
            icon={<CalendarRange className="h-4 w-4" />}
            label="Current academic year"
            value={current?.name ?? "Not set up yet"}
          />
          <LinkRow to="/settings/academic-year" label="Manage academic years and term periods" />
          <LinkRow to="/settings/academic-year" label={current ? "Set up new year" : "Set up your first year"} primary />
        </Section>

        <Section title="School preferences">
          <LinkRow to="/settings/preferences" label="Report comment length" icon={<Sliders className="h-4 w-4" />} />
        </Section>

        <Section title="Profile">
          <div className="px-4 py-3 space-y-2">
            <label htmlFor="profile-name" className="text-sm">
              Name
            </label>
            <p className="text-xs text-muted-foreground">
              Shown in your dashboard greeting (Hi …).
            </p>
            <div className="flex gap-2">
              <Input
                id="profile-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveName();
                }}
                maxLength={60}
                className="h-11 rounded-xl"
                autoComplete="name"
              />
              <Button
                type="button"
                onClick={() => void saveName()}
                disabled={!dirty || saving || !name.trim()}
                className="h-11 rounded-xl shrink-0"
              >
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
          <Row label="Email" value={user.email ?? "—"} />
        </Section>

        <Section title="Subscription">
          <Row
            icon={<CreditCard className="h-4 w-4" />}
            label="Current plan"
            value={sub.plan ? PLAN_LABELS[sub.plan] : "—"}
          />
          <LinkRow to="/billing" label="Manage subscription" />
        </Section>

        <Section title="Support">
          <Row icon={<Mail className="h-4 w-4" />} label="Email" value={PRODUCT.supportEmail} />
          <LinkRow to="/privacy" label="Privacy policy" icon={<ShieldCheck className="h-4 w-4" />} />
          <LinkRow to="/terms" label="Terms of service" icon={<FileText className="h-4 w-4" />} />
        </Section>
      </div>
    </AppShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-2 px-1">{title}</p>
      <div className="rounded-2xl bg-card shadow-soft divide-y divide-border overflow-hidden">{children}</div>
    </div>
  );
}

function Row({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      {icon && <span className="text-muted-foreground">{icon}</span>}
      <span className="text-sm flex-1">{label}</span>
      <span className="text-sm text-muted-foreground truncate max-w-[55%] text-right">{value}</span>
    </div>
  );
}

function LinkRow({
  to, label, icon, primary,
}: { to: string; label: string; icon?: React.ReactNode; primary?: boolean }) {
  return (
    <Link to={to} className="flex items-center gap-3 px-4 py-3 hover:bg-card-warm">
      {icon && <span className="text-muted-foreground">{icon}</span>}
      <span className={`text-sm flex-1 ${primary ? "text-primary font-medium" : ""}`}>{label}</span>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </Link>
  );
}
