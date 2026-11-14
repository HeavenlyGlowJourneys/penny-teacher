// Gated diagnostic logger for Penny pipeline.
// Enabled when:
//   - running a dev build (import.meta.env.DEV), OR
//   - localStorage.penny_debug === "1" (toggle live in browser console)
//
// Errors are NEVER gated — real failures must always reach the console.

function debugEnabled(): boolean {
  try {
    if (typeof window !== "undefined" && window.localStorage?.getItem("penny_debug") === "1") {
      return true;
    }
  } catch {
    // localStorage may throw in private mode / SSR — fall through.
  }
  return Boolean(import.meta.env?.DEV);
}

export function dlog(...args: unknown[]): void {
  if (debugEnabled()) console.log(...args);
}

export function dwarn(...args: unknown[]): void {
  if (debugEnabled()) console.warn(...args);
}
