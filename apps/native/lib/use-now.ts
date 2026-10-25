import { useEffect, useState } from "react";
import { AppState } from "react-native";

/**
 * The clock as state: it ticks every `intervalMs` and at once when the app comes back to the foreground,
 * so anything derived from it (the release gate's 24 h grace) is recomputed while a screen stays open.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, intervalMs);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") tick();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [intervalMs]);
  return now;
}
