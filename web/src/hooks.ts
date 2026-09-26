// Loading data, and refreshing it while the system is still working.

import { useCallback, useEffect, useRef, useState } from "react";

/** Loads `load()` whenever `key` changes, and re-loads every `everyMs` while `pollWhile(data)` is true. */
export function useData<T>(load: () => Promise<T>, key: string, pollWhile?: (data: T) => boolean, everyMs = 2500) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  const refresh = useCallback(async () => {
    try {
      setData(await loadRef.current());
      setError(null);
    } catch (e) {
      setError(e as Error);
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` identifies what `load` fetches; a new key must reload
  useEffect(() => {
    setData(null);
    void refresh();
  }, [key, refresh]);

  useEffect(() => {
    if (!data || !pollWhile?.(data)) return;
    const timer = setTimeout(refresh, everyMs);
    return () => clearTimeout(timer);
  }, [data, pollWhile, everyMs, refresh]);

  return { data, error, refresh, setData };
}
