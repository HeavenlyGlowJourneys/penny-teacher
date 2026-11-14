import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Mic, Square, Save, ChevronLeft, ChevronRight, X, Sparkles, Check, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/penny/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { dlog, dwarn } from "@/lib/debug-log";

export const Route = createFileRoute("/_authenticated/learn/$classId")({
  head: () => ({ meta: [{ title: "Learn your learners – Penny" }] }),
  component: LearnLearnersPage,
});

type Learner = {
  id: string;
  name: string;
  pronunciation: string | null;
  aliases: string[];
  pronunciation_audio_path: string | null;
};

function LearnLearnersPage() {
  const { classId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  dlog("[penny:learn] mounted with classId:", classId);

  const { data: learners = [], isLoading, error } = useQuery({
    queryKey: ["learners-learn", classId],
    queryFn: async () => {
      dlog("[learn] fetching learners for class", classId);
      const { data, error } = await supabase
        .from("learners")
        .select("id, name, pronunciation, aliases, active, pronunciation_audio_path")
        .eq("class_id", classId)
        .eq("active", true)
        .order("sort_key");
      if (error) {
        console.error("[learn] query error — see server logs");
        throw error;
      }
      const rows = (data ?? []).map((l) => ({
        ...l,
        aliases: (l.aliases as string[] | null) ?? [],
        pronunciation_audio_path: (l as { pronunciation_audio_path?: string | null }).pronunciation_audio_path ?? null,
      })) as Learner[];
      for (const r of rows) {
        dlog("[learn] loaded learner", {
          name: r.name,
          pronunciation: r.pronunciation,
          aliases: r.aliases,
          audio: r.pronunciation_audio_path ? "✓ recorded" : "—",
        });
      }
      return rows;
    },
  });

  const [idx, setIdx] = useState(0);
  useEffect(() => { if (idx >= learners.length) setIdx(Math.max(0, learners.length - 1)); }, [learners.length, idx]);
  const current = learners[idx];

  if (isLoading) {
    return <AppShell back={{ to: `/class/${classId}` }} title="Let's Learn Your Learners"><div className="h-40 rounded-2xl bg-card animate-pulse" /></AppShell>;
  }

  if (error) {
    return (
      <AppShell back={{ to: `/class/${classId}` }} title="Let's Learn Your Learners">
        <div className="rounded-2xl bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
          Couldn't load your learners: {error instanceof Error ? error.message : String(error)}
        </div>
      </AppShell>
    );
  }

  if (!current) {
    return (
      <AppShell back={{ to: `/class/${classId}` }} title="Let's Learn Your Learners">
        <p className="text-sm text-muted-foreground">Add learners first, then come back to teach Penny their names.</p>
      </AppShell>
    );
  }

  return (
    <AppShell back={{ to: `/class/${classId}` }} title="Let's Learn Your Learners">
      <div className="rounded-2xl bg-primary-soft border border-primary/20 p-3 mb-4 flex items-start gap-2">
        <Sparkles className="h-4 w-4 text-primary mt-0.5 flex-none" />
        <p className="text-xs text-foreground">
          Add the way you say each name and any nicknames you use in class — e.g. <em>Alex</em> for Alex Morgan,
          <em> Tay</em> for Taylor Brooks. Penny matches against all of these when capturing marks.
        </p>
      </div>

      <div className="text-xs text-muted-foreground mb-2 text-center">
        Learner {idx + 1} of {learners.length}
      </div>

      <LearnerCard
        key={current.id}
        learner={current}
        onSaved={() => qc.invalidateQueries({ queryKey: ["learners-learn", classId] })}
      />

      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-md flex gap-2">
        <Button
          variant="outline"
          className="h-14 rounded-2xl px-4"
          onClick={() => setIdx((i) => Math.max(0, i - 1))}
          disabled={idx === 0}
          aria-label="Previous learner"
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        {idx < learners.length - 1 ? (
          <Button className="flex-1 h-14 rounded-2xl text-base shadow-warm" onClick={() => setIdx((i) => i + 1)}>
            Next learner <ChevronRight className="h-5 w-5 ml-1" />
          </Button>
        ) : (
          <Button className="flex-1 h-14 rounded-2xl text-base shadow-warm" onClick={() => navigate({ to: "/class/$classId", params: { classId } })}>
            Done <Save className="h-5 w-5 ml-1" />
          </Button>
        )}
      </div>
    </AppShell>
  );
}

function LearnerCard({ learner, onSaved }: { learner: Learner; onSaved: () => void }) {
  const [pron, setPron] = useState(learner.pronunciation ?? "");
  const [aliases, setAliases] = useState<string[]>(learner.aliases);
  const [aliasInput, setAliasInput] = useState("");
  const [busy, setBusy] = useState(false);

  // Voice recording — persisted to Supabase storage so it survives refresh.
  const [recState, setRecState] = useState<"idle" | "recording" | "ready">("idle");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [pendingBlob, setPendingBlob] = useState<Blob | null>(null);
  const [storedPath, setStoredPath] = useState<string | null>(learner.pronunciation_audio_path);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Load any existing audio for this learner.
  useEffect(() => {
    setPron(learner.pronunciation ?? "");
    setAliases(learner.aliases ?? []);
    setAliasInput("");
    setRecState("idle");
    setPendingBlob(null);
    setStoredPath(learner.pronunciation_audio_path);
    setAudioUrl(null);

    let revoke: string | null = null;
    let cancelled = false;
    if (learner.pronunciation_audio_path) {
      supabase.storage
        .from("pronunciations")
        .createSignedUrl(learner.pronunciation_audio_path, 60 * 60)
        .then(({ data, error }) => {
          if (cancelled) return;
          if (error) {
            dwarn("[learn] signed-url failed:", error.message);
            return;
          }
          if (data?.signedUrl) {
            revoke = data.signedUrl;
            setAudioUrl(data.signedUrl);
          }
        });
    }
    return () => {
      cancelled = true;
      if (revoke && revoke.startsWith("blob:")) URL.revokeObjectURL(revoke);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [learner.id]);

  function addAlias() {
    const a = aliasInput.trim();
    if (!a) return;
    if (aliases.some((x) => x.toLowerCase() === a.toLowerCase())) {
      setAliasInput("");
      return;
    }
    setAliases([...aliases, a]);
    setAliasInput("");
  }

  async function startRec() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => chunksRef.current.push(e.data);
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (audioUrl?.startsWith("blob:")) URL.revokeObjectURL(audioUrl);
        setAudioUrl(URL.createObjectURL(blob));
        setPendingBlob(blob);
        setRecState("ready");
        stream.getTracks().forEach((t) => t.stop());
      };
      recRef.current = mr;
      mr.start();
      setRecState("recording");
    } catch {
      toast.error("Microphone permission denied");
    }
  }
  function stopRec() {
    recRef.current?.stop();
  }

  async function deleteAudio() {
    if (!storedPath) {
      setPendingBlob(null);
      setAudioUrl(null);
      setRecState("idle");
      return;
    }
    setBusy(true);
    const { error: rmErr } = await supabase.storage.from("pronunciations").remove([storedPath]);
    if (rmErr) dwarn("[learn] remove audio failed:", rmErr.message);
    const { error } = await supabase
      .from("learners")
      .update({ pronunciation_audio_path: null })
      .eq("id", learner.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setStoredPath(null);
    setPendingBlob(null);
    setAudioUrl(null);
    setRecState("idle");
    toast.success("Recording removed");
    onSaved();
  }

  async function save() {
    setBusy(true);
    dlog("[learn] saving pronunciation", {
      learner: learner.name,
      pronunciation: pron.trim() || null,
      aliases,
      audioPending: !!pendingBlob,
    });

    let audioPath: string | null | undefined = undefined; // undefined = don't change
    if (pendingBlob) {
      const { data: sess } = await supabase.auth.getUser();
      const uid = sess.user?.id;
      if (!uid) {
        setBusy(false);
        toast.error("Not signed in");
        return;
      }
      const path = `${uid}/${learner.id}.webm`;
      const { error: upErr } = await supabase.storage
        .from("pronunciations")
        .upload(path, pendingBlob, { upsert: true, contentType: "audio/webm" });
      if (upErr) {
        setBusy(false);
        console.error("[learn] upload failed:", upErr.message);
        toast.error("Couldn't save recording: " + upErr.message);
        return;
      }
      audioPath = path;
    }

    const update: {
      pronunciation: string | null;
      aliases: string[];
      pronunciation_audio_path?: string | null;
    } = {
      pronunciation: pron.trim() || null,
      aliases,
    };
    if (audioPath !== undefined) update.pronunciation_audio_path = audioPath;

    const { error } = await supabase.from("learners").update(update).eq("id", learner.id);
    setBusy(false);
    if (error) {
      console.error("[learn] save failed:", error.message);
      toast.error(error.message);
    } else {
      dlog("[learn] save success", { learner: learner.name, audioPath: audioPath ?? storedPath });
      if (audioPath) setStoredPath(audioPath);
      setPendingBlob(null);
      toast.success("Saved");
      onSaved();
    }
  }

  const hasAudio = !!storedPath || !!pendingBlob;

  return (
    <div className="rounded-3xl bg-card p-5 shadow-soft space-y-4 pb-6">
      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Official name</p>
        <p className="font-display text-2xl font-semibold mt-0.5 leading-tight break-words">{learner.name}</p>
        {(learner.pronunciation || learner.pronunciation_audio_path) && (
          <p className="inline-flex items-center gap-1 mt-2 text-xs text-primary bg-primary-soft rounded-full px-2 py-0.5">
            <Check className="h-3 w-3" /> Pronunciation recorded
          </p>
        )}
      </div>

      <div>
        <label className="text-xs uppercase tracking-wide text-muted-foreground">How do you say it?</label>
        <Input
          value={pron}
          onChange={(e) => setPron(e.target.value)}
          placeholder="e.g. Koo-mo"
          className="h-12 rounded-xl text-base mt-1"
        />
        <p className="text-[11px] text-muted-foreground mt-1">Helps Penny match what speech recognition hears.</p>
      </div>

      <div>
        <label className="text-xs uppercase tracking-wide text-muted-foreground">Nicknames & aliases</label>
        <div className="flex gap-2 mt-1">
          <Input
            value={aliasInput}
            onChange={(e) => setAliasInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAlias(); } }}
            placeholder="e.g. Alex, Tay"
            className="h-12 rounded-xl text-base"
          />
          <Button onClick={addAlias} variant="outline" className="h-12 rounded-xl px-4">Add</Button>
        </div>
        {aliases.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {aliases.map((a, i) => (
              <span key={`${a}-${i}`} className="inline-flex items-center gap-1 text-sm bg-primary-soft text-foreground rounded-full pl-3 pr-1.5 py-1">
                {a}
                <button
                  onClick={() => setAliases(aliases.filter((_, j) => j !== i))}
                  className="rounded-full p-0.5 hover:bg-primary/20"
                  aria-label={`Remove ${a}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div>
        <label className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-2">
          Practice saying it
          {hasAudio && <span className="inline-flex items-center gap-1 text-[11px] text-primary"><Check className="h-3 w-3" /> recorded</span>}
        </label>
        <div className="flex items-center gap-2 mt-1">
          {recState !== "recording" ? (
            <Button variant="outline" onClick={startRec} className="h-12 rounded-xl flex-1">
              <Mic className="h-4 w-4 mr-1.5" /> {hasAudio ? "Re-record" : "Record"}
            </Button>
          ) : (
            <Button onClick={stopRec} className="h-12 rounded-xl flex-1 bg-destructive text-destructive-foreground hover:bg-destructive/90">
              <Square className="h-4 w-4 mr-1.5" /> Stop
            </Button>
          )}
          {hasAudio && (
            <Button
              variant="outline"
              onClick={deleteAudio}
              disabled={busy}
              className="h-12 rounded-xl px-3"
              aria-label="Delete recording"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
        {audioUrl && (
          <audio src={audioUrl} controls className="w-full mt-2 h-10" />
        )}
        <p className="text-[11px] text-muted-foreground mt-1">Saved with your learner so you can replay it later.</p>
      </div>

      <Button onClick={save} disabled={busy} className="w-full h-12 rounded-xl">
        <Save className="h-4 w-4 mr-1.5" /> {busy ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}
