import { memo, useEffect, useState } from "react";

function formatTime(milliseconds) {
  const safe = Math.max(0, milliseconds || 0);
  const minutes = Math.floor(safe / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1_000);
  const centiseconds = Math.floor((safe % 1_000) / 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

export const LiveTimer = memo(function LiveTimer({ startedAt, elapsedMs, running }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!running || !startedAt) return undefined;
    let frame;
    const tick = () => {
      setNow(Date.now());
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, startedAt]);

  const shown = running && startedAt ? now - startedAt : elapsedMs;
  return <span>{formatTime(shown)}</span>;
});

export function formatCompact(milliseconds) {
  return `${((milliseconds || 0) / 1000).toFixed(2)}s`;
}
