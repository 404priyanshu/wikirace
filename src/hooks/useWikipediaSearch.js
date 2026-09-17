import { useEffect, useState } from "react";

export function useWikipediaSearch(value, enabled = true) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const query = value.trim();
    if (!enabled || query.length < 2) {
      setResults([]);
      return undefined;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/articles/search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        const payload = await response.json();
        setResults(payload.results || []);
      } catch (error) {
        if (error.name !== "AbortError") setResults([]);
      } finally {
        setLoading(false);
      }
    }, 180);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [enabled, value]);

  return { results, loading, clear: () => setResults([]) };
}
