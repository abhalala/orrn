import { useEffect, useState } from "react";

/** A value that follows `value` after it has stayed put for `ms` (search boxes: one request per pause, not per key). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}
