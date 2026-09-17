import { memo } from "react";

function formatTime(milliseconds) {
  const safe = Math.max(0, milliseconds || 0);
  const minutes = Math.floor(safe / 60_000);
  const seconds = Math.floor((safe % 60_000) / 1_000);
  const centiseconds = Math.floor((safe % 1_000) / 10);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

/**
 * The clock only advances while a model is deciding, so there is nothing to
 * animate between hops. Showing a smooth wall-clock tick here would be a lie:
 * most of that time is Wikipedia serving pages, which the race does not score.
 */
export const LiveTimer = memo(function LiveTimer({ elapsedMs }) {
  return <span>{formatTime(elapsedMs)}</span>;
});

export function formatCompact(milliseconds) {
  return `${((milliseconds || 0) / 1000).toFixed(2)}s`;
}
