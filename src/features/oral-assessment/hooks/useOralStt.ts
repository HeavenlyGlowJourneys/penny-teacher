/**
 * Speech-to-Text for oral assessment with end-of-answer silence detection.
 * Accumulates finals until the student finishes speaking.
 */
import { useCallback, useEffect, useRef, useState } from "react";

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
  abort: () => void;
};
type SRCtor = new () => SR;

export type OralSttState = "idle" | "listening" | "unsupported" | "error";

const DEFAULT_SILENCE_MS = 2200;
const MAX_ANSWER_MS = 180_000;

let activeStop: (() => void) | null = null;

export function useOralStt(opts?: { silenceMs?: number; lang?: string }) {
  const silenceMs = opts?.silenceMs ?? DEFAULT_SILENCE_MS;
  const lang = opts?.lang ?? "en-GB";

  const [state, setState] = useState<OralSttState>("idle");
  const [interim, setInterim] = useState("");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const ctorRef = useRef<SRCtor | null>(null);
  const recRef = useRef<SR | null>(null);
  const wantOnRef = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bufferRef = useRef("");
  const onCompleteRef = useRef<((text: string) => void) | null>(null);
  const stopSelfRef = useRef<() => void>(() => {});

  const clearTimers = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (maxTimerRef.current) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
  }, []);

  const finishAnswer = useCallback(
    (text: string) => {
      const trimmed = text.replace(/\s+/g, " ").trim();
      wantOnRef.current = false;
      clearTimers();
      const prev = recRef.current;
      if (prev) {
        prev.onstart = null;
        prev.onresult = null;
        prev.onerror = null;
        prev.onend = null;
        try {
          prev.stop();
        } catch {
          /* noop */
        }
      }
      recRef.current = null;
      if (activeStop === stopSelfRef.current) activeStop = null;
      setState("idle");
      setInterim("");
      bufferRef.current = "";
      if (trimmed) onCompleteRef.current?.(trimmed);
    },
    [clearTimers],
  );

  const scheduleSilence = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = setTimeout(() => {
      if (!wantOnRef.current) return;
      const text = `${bufferRef.current}`.trim();
      if (text.length >= 8) {
        finishAnswer(text);
      }
      // If too short, keep listening — student may still be thinking
    }, silenceMs);
  }, [finishAnswer, silenceMs]);

  const createRecognition = useCallback(() => {
    const Ctor = ctorRef.current;
    if (!Ctor) return null;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang;
    const isCurrent = () => recRef.current === rec;

    rec.onstart = () => {
      if (!isCurrent()) return;
      if (wantOnRef.current) setState("listening");
    };

    rec.onresult = (e) => {
      if (!isCurrent() || !wantOnRef.current) return;
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const t = r[0].transcript;
        if (r.isFinal) {
          const trimmed = t.trim();
          if (trimmed) {
            bufferRef.current = `${bufferRef.current} ${trimmed}`.trim();
            setLiveTranscript(bufferRef.current);
          }
        } else {
          interimText += t;
        }
      }
      setInterim(interimText);
      scheduleSilence();
    };

    rec.onerror = (e) => {
      if (!isCurrent()) return;
      if (e.error === "no-speech" || e.error === "aborted") {
        // Keep listening through brief silence; silence timer handles end.
        return;
      }
      if (e.error === "network") {
        setErrorMsg("Connection interrupted — trying again…");
        return;
      }
      setErrorMsg(e.error);
      wantOnRef.current = false;
      setState("error");
    };

    rec.onend = () => {
      if (!isCurrent()) return;
      if (wantOnRef.current) {
        restartTimerRef.current = setTimeout(() => {
          if (!wantOnRef.current) return;
          const next = createRecognition();
          recRef.current = next;
          try {
            next?.start();
            setState("listening");
          } catch {
            /* will retry via user Start */
          }
        }, 140);
      } else {
        setState("idle");
        setInterim("");
      }
    };

    return rec;
  }, [lang, scheduleSilence]);

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
    return () => {
      wantOnRef.current = false;
      clearTimers();
      try {
        recRef.current?.abort();
      } catch {
        /* noop */
      }
    };
  }, [clearTimers]);

  const stop = useCallback(() => {
    wantOnRef.current = false;
    clearTimers();
    const prev = recRef.current;
    if (prev) {
      prev.onstart = null;
      prev.onresult = null;
      prev.onerror = null;
      prev.onend = null;
      try {
        prev.stop();
      } catch {
        /* noop */
      }
    }
    recRef.current = null;
    if (activeStop === stopSelfRef.current) activeStop = null;
    setState("idle");
    setInterim("");
  }, [clearTimers]);

  stopSelfRef.current = stop;

  const start = useCallback(
    (onComplete: (text: string) => void) => {
      if (!ctorRef.current) {
        setState("unsupported");
        return;
      }
      if (activeStop && activeStop !== stopSelfRef.current) {
        try {
          activeStop();
        } catch {
          /* noop */
        }
      }
      activeStop = stopSelfRef.current;
      onCompleteRef.current = onComplete;
      setErrorMsg(null);
      bufferRef.current = "";
      setLiveTranscript("");
      setInterim("");
      wantOnRef.current = true;
      clearTimers();

      const prev = recRef.current;
      if (prev) {
        prev.onstart = null;
        prev.onresult = null;
        prev.onerror = null;
        prev.onend = null;
        try {
          prev.stop();
        } catch {
          /* noop */
        }
      }
      recRef.current = createRecognition();
      try {
        recRef.current?.start();
        setState("listening");
        maxTimerRef.current = setTimeout(() => {
          if (!wantOnRef.current) return;
          const text = bufferRef.current.trim();
          if (text) finishAnswer(text);
        }, MAX_ANSWER_MS);
      } catch {
        wantOnRef.current = false;
        setErrorMsg("Could not start microphone");
        setState("error");
      }
    },
    [clearTimers, createRecognition, finishAnswer],
  );

  /** Finalize current buffer early (e.g. student taps Done speaking). */
  const commitNow = useCallback(() => {
    const text = `${bufferRef.current} ${interim}`.replace(/\s+/g, " ").trim();
    if (text) finishAnswer(text);
    else stop();
  }, [finishAnswer, interim, stop]);

  return {
    state,
    interim,
    liveTranscript,
    errorMsg,
    start,
    stop,
    commitNow,
    isListening: state === "listening",
  };
}
