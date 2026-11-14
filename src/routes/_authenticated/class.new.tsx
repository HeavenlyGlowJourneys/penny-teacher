import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Upload, FileSpreadsheet, X, Plus, Mic, Square, Camera, Image as ImageIcon, Loader2, Lightbulb } from "lucide-react";
import * as XLSX from "xlsx";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/penny/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { GRADES } from "@/lib/penny";
import { useVoice } from "@/hooks/use-voice";
import { extractNamesFromImage, extractNamesFromTranscript } from "@/lib/import-names.functions";
import { toast } from "sonner";
import { useSubscription } from "@/hooks/use-subscription";

export const Route = createFileRoute("/_authenticated/class/new")({
  head: () => ({ meta: [{ title: "New class – Penny" }] }),
  component: NewClass,
});

type ImportMode = "manual" | "voice" | "photo";

const GUIDE_KEY = "penny_class_setup_guide_shown";

function NewClass() {
  const navigate = useNavigate();
  const { user } = Route.useRouteContext();
  const [showGuide, setShowGuide] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const [dupClassId, setDupClassId] = useState<string | null>(null);
  const [step, setStep] = useState<1 | 2>(1);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.localStorage.getItem(GUIDE_KEY)) setShowGuide(true);
  }, []);

  function dismissGuide() {
    if (typeof window !== "undefined") window.localStorage.setItem(GUIDE_KEY, "1");
    setShowGuide(false);
  }
  const [grade, setGrade] = useState("Grade 7");
  const [subject, setSubject] = useState("");
  const [name, setName] = useState("");
  const [learners, setLearners] = useState<string[]>([]);
  const [importMode, setImportMode] = useState<ImportMode>("photo");
  const [bulk, setBulk] = useState("");
  const [busy, setBusy] = useState(false);
  const sub = useSubscription();

  function addNames(names: string[]) {
    const cleaned = names.map((n) => n.trim()).filter(Boolean);
    if (!cleaned.length) return;
    setLearners((prev) => {
      const existing = new Set(prev.map((p) => p.toLowerCase()));
      const next = [...prev];
      for (const n of cleaned) {
        if (!existing.has(n.toLowerCase())) { next.push(n); existing.add(n.toLowerCase()); }
      }
      return next;
    });
    toast.success(`Added ${cleaned.length} learner${cleaned.length === 1 ? "" : "s"}`);
  }

  function addFromBulk() {
    const lines = bulk.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
    if (!lines.length) return;
    addNames(lines);
    setBulk("");
  }

  async function handleExcel(file: File) {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
      const names: string[] = [];
      for (const row of rows) {
        const values = Object.values(row).map((v) => String(v ?? "").trim()).filter(Boolean);
        if (values.length) names.push(values.slice(0, 2).join(" ").trim());
      }
      if (!names.length) return toast.error("No names found in that spreadsheet");
      addNames(names);
    } catch {
      toast.error("Could not read that file");
    }
  }

  async function save(skipDupCheck = false) {
    if (sub.isExpired) {
      toast.error("Your subscription has expired — add a payment method to keep going.");
      return;
    }
    if (!sub.canAddClass) {
      toast.error("Your trial has ended — add a payment method to keep adding classes.");
      return;
    }
    if (!name.trim() || !subject.trim() || !grade) {
      toast.error("Please fill in grade, subject, and class name");
      return;
    }
    if (!skipDupCheck) {
      const { data: existing } = await supabase
        .from("classes")
        .select("id")
        .eq("teacher_id", user.id)
        .ilike("name", name.trim())
        .limit(1)
        .maybeSingle();
      if (existing?.id) {
        setDupClassId(existing.id);
        setDupOpen(true);
        return;
      }
    }
    setBusy(true);
    try {
      const { data: cls, error } = await supabase
        .from("classes")
        .insert({ teacher_id: user.id, grade, subject: subject.trim(), name: name.trim() })
        .select("id").single();
      if (error) throw error;
      if (learners.length) {
        const { error: lerr } = await supabase.from("learners").insert(
          learners.map((n) => ({ class_id: cls.id, teacher_id: user.id, name: n })),
        );
        if (lerr) throw lerr;
      }
      toast.success(`${name} is ready!`);
      // Send the teacher into "Learn your learners" immediately if any were added
      if (learners.length) {
        navigate({ to: "/learn/$classId", params: { classId: cls.id } });
      } else {
        navigate({ to: "/class/$classId", params: { classId: cls.id } });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell back="/dashboard" title={step === 1 ? "New class" : "Add learners"}>
      {step === 1 ? (
        <div className="space-y-5">
          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Grade</Label>
            <Select value={grade} onValueChange={setGrade}>
              <SelectTrigger className="h-12 rounded-xl mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{GRADES.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="subject" className="text-xs uppercase tracking-wide text-muted-foreground">Subject</Label>
            <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="English" className="h-12 rounded-xl mt-1" />
          </div>
          <div>
            <Label htmlFor="name" className="text-xs uppercase tracking-wide text-muted-foreground">Class name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Grade 7 English 7H" className="h-12 rounded-xl mt-1" />
          </div>
          <Button type="button" onClick={() => setStep(2)} disabled={!grade || !subject.trim() || !name.trim()} className="w-full h-14 rounded-2xl text-base">
            Next: add learners
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <ModeButton active={importMode === "photo"} onClick={() => setImportMode("photo")} icon={<Camera className="h-5 w-5" />} label="Photo" sub="Fastest" />
            <ModeButton active={importMode === "voice"} onClick={() => setImportMode("voice")} icon={<Mic className="h-5 w-5" />} label="Voice" />
            <ModeButton active={importMode === "manual"} onClick={() => setImportMode("manual")} icon={<Plus className="h-5 w-5" />} label="Type" />
          </div>

          {importMode === "photo" && <PhotoImport onNames={addNames} onExcel={handleExcel} />}
          {importMode === "voice" && <VoiceImport onNames={addNames} />}
          {importMode === "manual" && (
            <div className="rounded-2xl bg-card p-4 shadow-soft">
              <h3 className="font-display text-base font-semibold">Type or paste names</h3>
              <p className="text-xs text-muted-foreground">One per line, or comma-separated.</p>
              <Textarea value={bulk} onChange={(e) => setBulk(e.target.value)} rows={4} placeholder={"Alex Morgan\nJordan Lee\nTaylor Brooks"} className="mt-2 rounded-xl" />
              <Button type="button" variant="secondary" className="mt-2 rounded-xl" onClick={addFromBulk}>
                <Plus className="h-4 w-4 mr-1" /> Add to list
              </Button>
            </div>
          )}

          {learners.length > 0 && (
            <div className="rounded-2xl bg-card p-4 shadow-soft">
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-display text-base font-semibold">Review {learners.length} learner{learners.length === 1 ? "" : "s"}</h3>
                <button onClick={() => setLearners([])} className="text-xs text-muted-foreground hover:text-destructive">Clear all</button>
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                Tap any name to fix spelling. Voice and photo import aren't perfect — check surnames especially.
              </p>
              <ul className="divide-y divide-border max-h-72 overflow-y-auto">
                {learners.map((n, i) => (
                  <li key={i} className="flex items-center gap-2 py-1.5">
                    <span className="text-xs text-muted-foreground w-6 shrink-0">{i + 1}.</span>
                    <input
                      value={n}
                      onChange={(e) => setLearners((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                      className="flex-1 bg-transparent text-base outline-none focus:bg-muted/60 rounded-lg px-2 py-2 min-w-0"
                      aria-label={`Edit learner name ${i + 1}`}
                    />
                    <button onClick={() => setLearners((prev) => prev.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive p-2 shrink-0" aria-label={`Remove ${n}`}>
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-md flex gap-2">
            <Button type="button" variant="secondary" className="h-14 rounded-2xl" onClick={() => setStep(1)} disabled={busy}>Back</Button>
            <Button type="button" className="flex-1 h-14 rounded-2xl text-base shadow-warm" onClick={() => save()} disabled={busy}>
              {busy ? "Saving…" : `Save class${learners.length ? ` & ${learners.length} learners` : ""}`}
            </Button>
          </div>
        </div>
      )}
      <Dialog open={showGuide} onOpenChange={(o) => { if (!o) dismissGuide(); }}>
        <DialogContent className="rounded-3xl max-w-md">
          <DialogHeader>
            <div className="flex justify-center mb-2">
              <div className="h-12 w-12 rounded-2xl bg-primary-soft flex items-center justify-center text-primary">
                <Lightbulb className="h-6 w-6" />
              </div>
            </div>
            <DialogTitle className="font-display text-xl text-center">A quick tip before you start</DialogTitle>
            <DialogDescription asChild>
              <div className="text-sm leading-relaxed space-y-3 pt-2 text-left">
                <p>How you set up your classes affects how Penny organises your assessments.</p>
                <div>
                  <p className="font-medium text-foreground">If you teach multiple subjects to the same learners:</p>
                  <ul className="mt-1 space-y-0.5 pl-1">
                    <li>→ Create ONE class</li>
                    <li>→ Tag each assessment with its subject</li>
                    <li>→ Penny organises them into subject tabs automatically</li>
                  </ul>
                </div>
                <div>
                  <p className="font-medium text-foreground">If you teach one subject to different groups:</p>
                  <ul className="mt-1 pl-1"><li>→ Create one class per group</li></ul>
                </div>
                <p className="italic">Not sure? Start with one class and add your assessments — you can always adjust later.</p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <Button className="h-12 rounded-xl w-full mt-2" onClick={dismissGuide}>
            Got it — create my class
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={dupOpen} onOpenChange={setDupOpen}>
        <DialogContent className="rounded-3xl max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display text-lg">You already have a class called {name.trim()}.</DialogTitle>
            <DialogDescription>Are these the same learners for a different subject?</DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              className="h-11 rounded-xl w-full"
              onClick={() => {
                setDupOpen(false);
                if (dupClassId) navigate({ to: "/assessment/new/$classId", params: { classId: dupClassId } });
              }}
            >
              Yes — add an assessment to the existing class
            </Button>
            <Button
              variant="secondary"
              className="h-11 rounded-xl w-full"
              onClick={() => { setDupOpen(false); void save(true); }}
            >
              No — different group, create new class
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>

  );
}

function ModeButton({ active, onClick, icon, label, sub }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; sub?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl p-3 text-center border-2 transition-colors ${active ? "border-primary bg-primary-soft" : "border-border bg-card"}`}
    >
      <div className="flex justify-center text-primary">{icon}</div>
      <p className="font-medium text-sm mt-1">{label}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────
// PHOTO / PDF IMPORT (OCR via Gemini)
// ────────────────────────────────────────────────────────────────────
function PhotoImport({ onNames, onExcel }: { onNames: (names: string[]) => void; onExcel: (f: File) => void }) {
  const ocrFn = useServerFn(extractNamesFromImage);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  async function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(file);
    });
  }

  async function handleFile(file: File) {
    // Spreadsheets → take the local path; everything else → OCR
    if (/\.(xlsx|xls|csv)$/i.test(file.name)) return onExcel(file);
    if (file.size > 4 * 1024 * 1024) {
      toast.error("Image is too large — please use a photo under 4 MB.");
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      if (dataUrl.startsWith("data:image")) setPreview(dataUrl);
      const { names } = await ocrFn({ data: { imageDataUrl: dataUrl } });
      if (!names.length) toast.error("Couldn't find any names in that image — try a clearer photo.");
      else onNames(names);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read that file");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl bg-card p-4 shadow-soft space-y-3">
      <div>
        <h3 className="font-display text-base font-semibold">Photo, screenshot, or PDF</h3>
        <p className="text-xs text-muted-foreground">School register · WhatsApp list · printout · spreadsheet screenshot.</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-14 rounded-xl flex-col gap-0.5" onClick={() => cameraRef.current?.click()} disabled={busy}>
          <Camera className="h-5 w-5" /> <span className="text-xs">Take photo</span>
        </Button>
        <Button variant="outline" className="h-14 rounded-xl flex-col gap-0.5" onClick={() => galleryRef.current?.click()} disabled={busy}>
          <ImageIcon className="h-5 w-5" /> <span className="text-xs">Upload</span>
        </Button>
      </div>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.currentTarget.value = ""; }} />
      <input ref={galleryRef} type="file" accept="image/*,application/pdf,.xlsx,.xls,.csv" className="sr-only"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.currentTarget.value = ""; }} />

      {busy && (
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-3">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading names…
        </div>
      )}
      {preview && !busy && (
        <div className="rounded-xl overflow-hidden border border-border">
          <img src={preview} alt="" className="w-full max-h-48 object-contain bg-muted" />
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        Tip: Penny ignores numbers, headers, and IDs — just snap the list.
      </p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// VOICE IMPORT (dictate names → AI cleans them up)
// ────────────────────────────────────────────────────────────────────
function VoiceImport({ onNames }: { onNames: (names: string[]) => void }) {
  const cleanFn = useServerFn(extractNamesFromTranscript);
  const [chunks, setChunks] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const { state, interim, start, stop } = useVoice((t) => setChunks((c) => [...c, t]));
  const listening = state === "listening";
  const transcript = chunks.join(" ");

  async function commit() {
    if (!transcript.trim()) return toast.error("Nothing recorded yet");
    setBusy(true);
    try {
      const { names } = await cleanFn({ data: { transcript } });
      if (!names.length) {
        // Fallback: split transcript naively
        const fallback = transcript.split(/[,;\n]| and | next /i).map((s) => s.trim()).filter(Boolean);
        if (fallback.length) onNames(fallback);
        else toast.error("Couldn't find any names — try again slower");
      } else {
        onNames(names);
      }
      setChunks([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl bg-card p-4 shadow-soft space-y-3">
      <div>
        <h3 className="font-display text-base font-semibold">Dictate learner names</h3>
        <p className="text-xs text-muted-foreground">Say each name. Pause between names. Tap Done when finished.</p>
      </div>
      <div className="flex flex-col items-center py-2">
        <button
          onClick={listening ? stop : start}
          disabled={state === "unsupported" || busy}
          className={`h-24 w-24 rounded-full flex items-center justify-center text-primary-foreground ${listening ? "bg-primary mic-pulse" : "bg-primary hover:scale-105 shadow-warm"}`}
          aria-label={listening ? "Stop" : "Start"}
        >
          {listening ? <Square className="h-9 w-9" /> : <Mic className="h-9 w-9" />}
        </button>
        <p className="text-sm font-medium mt-3">
          {state === "unsupported" ? "Voice isn't supported here" : listening ? "Listening… say names one by one" : "Tap to start"}
        </p>
        {listening && interim && <p className="text-xs italic text-muted-foreground mt-1">"{interim}"</p>}
      </div>
      {chunks.length > 0 && (
        <div className="rounded-xl bg-muted p-3 text-sm max-h-32 overflow-y-auto">
          {transcript}
        </div>
      )}
      <div className="flex gap-2">
        <Button variant="ghost" disabled={!chunks.length || busy} onClick={() => setChunks([])} className="flex-1">Clear</Button>
        <Button onClick={commit} disabled={!chunks.length || busy || listening} className="flex-1">
          {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null} Done — extract names
        </Button>
      </div>
    </div>
  );
}
