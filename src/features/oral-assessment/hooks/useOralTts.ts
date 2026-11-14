/**
 * High-quality browser Text-to-Speech for oral examiner turns.
 * Prefers natural English voices when available.
 *
 * Note: Chrome often double-speaks the start of an utterance right after
 * speechSynthesis.cancel(). We wait briefly and warm up with a no-op pause.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type TtsState = "idle" | "speaking" | "unsupported";

function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const preferred = [
    /google uk english female/i,
    /google us english/i,
    /microsoft (sonia|libby|jenny|aria|guy).*online/i,
    /microsoft (sonia|libby|jenny|aria)/i,
    /samantha/i,
    /karen/i,
    /moira/i,
  ];
  for (const re of preferred) {
    const hit = voices.find((v) => re.test(v.name) && /^en(-|_)/i.test(v.lang));
    if (hit) return hit;
  }
  return voices.find((v) => v.lang.toLowerCase().startsWith("en")) ?? voices[0] ?? null;
}

/** Split long text into speakable chunks so TTS doesn't truncate. */
function chunkForSpeech(text: string): string[] {
  const cleaned = text
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [];
  const parts = cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [cleaned];
  const chunks: string[] = [];
  let buf = "";
  for (const part of parts) {
    const next = `${buf} ${part}`.trim();
    if (next.length > 220 && buf) {
      chunks.push(buf);
      buf = part.trim();
    } else {
      buf = next;
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

function wait(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

export function useOralTts() {
  const [state, setState] = useState<TtsState>("idle");
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const cancelRef = useRef(false);
  const speakingRef = useRef(false);
  const speakGenRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      setState("unsupported");
      return;
    }
    const load = () => {
      voiceRef.current = pickVoice(window.speechSynthesis.getVoices());
    };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => {
      cancelRef.current = true;
      speakGenRef.current += 1;
      window.speechSynthesis.cancel();
      window.speechSynthesis.removeEventListener("voiceschanged", load);
    };
  }, []);

  const cancel = useCallback(() => {
    cancelRef.current = true;
    speakGenRef.current += 1;
    speakingRef.current = false;
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setState((s) => (s === "unsupported" ? s : "idle"));
  }, []);

  const speak = useCallback((text: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (typeof window === "undefined" || !window.speechSynthesis) {
        setState("unsupported");
        reject(new Error("Speech synthesis is not supported in this browser."));
        return;
      }

      const gen = ++speakGenRef.current;
      cancelRef.current = false;
      window.speechSynthesis.cancel();

      const chunks = chunkForSpeech(text);
      if (!chunks.length) {
        resolve();
        return;
      }

      void (async () => {
        // Chrome bug: speaking immediately after cancel() often repeats the first words.
        await wait(60);
        if (gen !== speakGenRef.current || cancelRef.current) {
          resolve();
          return;
        }

        // Resume if the synth was left in a paused/stuck state.
        try {
          window.speechSynthesis.resume();
        } catch {
          /* ignore */
        }

        speakingRef.current = true;
        setState("speaking");
        let i = 0;

        const speakNext = () => {
          if (gen !== speakGenRef.current || cancelRef.current) {
            speakingRef.current = false;
            setState("idle");
            resolve();
            return;
          }
          if (i >= chunks.length) {
            speakingRef.current = false;
            setState("idle");
            resolve();
            return;
          }
          const utter = new SpeechSynthesisUtterance(chunks[i++]);
          utter.voice = voiceRef.current;
          utter.rate = 0.96;
          utter.pitch = 1;
          utter.lang = voiceRef.current?.lang ?? "en-GB";
          utter.onend = () => {
            setTimeout(speakNext, 180);
          };
          utter.onerror = (e) => {
            if (
              cancelRef.current ||
              gen !== speakGenRef.current ||
              e.error === "canceled" ||
              e.error === "interrupted"
            ) {
              speakingRef.current = false;
              setState("idle");
              resolve();
              return;
            }
            speakingRef.current = false;
            setState("idle");
            reject(new Error(e.error || "Speech failed"));
          };
          window.speechSynthesis.speak(utter);
        };

        speakNext();
      })();
    });
  }, []);

  return { state, speak, cancel, isSpeaking: state === "speaking" };
}
