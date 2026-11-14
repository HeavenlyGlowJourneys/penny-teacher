import { useCallback, useEffect, useRef, useState } from "react";
import { dlog, dwarn } from "@/lib/debug-log";

// Minimal types for the Web Speech API
type SRResult = { isFinal: boolean; 0: { transcript: string } };
type SREvent = { resultIndex: number; results: ArrayLike<SRResult> };
type SR = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SRCtor = new () => SR;

export type VoiceState = "idle" | "listening" | "unsupported" | "error";

// Only one SpeechRecognition can be active in a tab at a time. Track the
// currently-listening hook instance so starting a new one cleanly stops the
// previous — otherwise the previous instance's auto-restart loop collides
// with the new .start() and the new mic captures nothing.
let activeStop: (() => void) | null = null;

export function useVoice(onFinalUtterance: (text: string) => void) {
  const [state, setState] = useState<VoiceState>("idle");
  const [interim, setInterim] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const ctorRef = useRef<SRCtor | null>(null);
  const recRef = useRef<SR | null>(null);
  const wantOnRef = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cbRef = useRef(onFinalUtterance);
  cbRef.current = onFinalUtterance;

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const createRecognition = useCallback(() => {
    const Ctor = ctorRef.current;
    if (!Ctor) return null;

    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    // Every handler must ignore events once this rec has been superseded —
    // otherwise a stopped-but-still-async-ending previous instance can
    // clobber recRef.current with a fresh recognizer and race against the
    // new listening session that the teacher just started.
    const isCurrent = () => recRef.current === rec;
    rec.onstart = () => {
      if (!isCurrent()) return;
      if (wantOnRef.current) setState("listening");
    };
    rec.onresult = (e) => {
      if (!isCurrent()) return;
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const t = r[0].transcript;
        if (r.isFinal) {
          const trimmed = t.trim();
          dlog("[penny:voice] RAW speech-engine final:", JSON.stringify(trimmed));
          if (trimmed) cbRef.current(trimmed);
        } else {
          dlog("[penny:voice] interim:", JSON.stringify(t));
          interimText += t;
        }
      }
      setInterim(interimText);
    };
    rec.onerror = (e) => {
      if (!isCurrent()) return;
      if (e.error === "no-speech" || e.error === "aborted") return;
      dwarn("[penny:voice] speech recognition error:", e.error);
      setErrorMsg(e.error);
      wantOnRef.current = false;
      setState("error");
    };
    rec.onend = () => {
      // Ignore end events from superseded recognizers — otherwise they'd
      // schedule a restart that overwrites the currently-active rec.
      if (!isCurrent()) return;
      // Chrome can end a recognition session immediately after it starts. If
      // the teacher still wants the mic on, create a fresh recognizer and
      // restart it instead of flipping the UI back to idle.
      if (wantOnRef.current) {
        clearRestartTimer();
        restartTimerRef.current = setTimeout(() => {
          if (!wantOnRef.current) return;
          const next = createRecognition();
          recRef.current = next;
          try {
            next?.start();
            setState("listening");
          } catch (err) {
            dwarn("[penny:voice] restart failed:", err);
          }
        }, 120);
      } else {
        setState("idle");
        setInterim("");
      }
    };

    return rec;
  }, [clearRestartTimer]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const Ctor =
      (window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: SRCtor }).webkitSpeechRecognition;
    if (!Ctor) {
      setState("unsupported");
      return;
    }
    ctorRef.current = Ctor;
    setState((current) => (current === "unsupported" ? "idle" : current));
    return () => {
      wantOnRef.current = false;
      clearRestartTimer();
      try { recRef.current?.stop(); } catch { /* noop */ }
    };
  }, [clearRestartTimer]);

  const stop = useCallback(() => {
    wantOnRef.current = false;
    clearRestartTimer();
    const prev = recRef.current;
    if (prev) {
      prev.onstart = null;
      prev.onresult = null;
      prev.onerror = null;
      prev.onend = null;
      try { prev.stop(); } catch { /* noop */ }
    }
    recRef.current = null;
    if (activeStop === stopSelfRef.current) activeStop = null;
    setState("idle");
    setInterim("");
  }, [clearRestartTimer]);

  // Keep a stable ref to the current stop fn so the module-level `activeStop`
  // can point at this instance without capturing a stale closure.
  const stopSelfRef = useRef<() => void>(() => {});
  stopSelfRef.current = stop;

  const start = useCallback(() => {
    if (!ctorRef.current) return;
    // Stop any other listening instance first — only one SR can be active.
    if (activeStop && activeStop !== stopSelfRef.current) {
      try { activeStop(); } catch { /* noop */ }
    }
    activeStop = stopSelfRef.current;
    setErrorMsg(null);
    wantOnRef.current = true;
    clearRestartTimer();
    // Detach handlers on the previous rec so its async onend/onerror can't
    // race the fresh one we're about to create.
    const prev = recRef.current;
    if (prev) {
      prev.onstart = null;
      prev.onresult = null;
      prev.onerror = null;
      prev.onend = null;
      try { prev.stop(); } catch { /* noop */ }
    }
    recRef.current = null;
    recRef.current = createRecognition();
    try {
      recRef.current?.start();
      setState("listening");
    } catch (err) {
      dwarn("[penny:voice] start failed:", err);
      wantOnRef.current = false;
      setErrorMsg("start-failed");
      setState("error");
    }
  }, [clearRestartTimer, createRecognition]);

  return { state, interim, errorMsg, start, stop };
}