import { Flag, Target } from "lucide-react";
import { useEffect, useRef } from "react";
import { formatCompact } from "./LiveTimer";

function wikipediaUrl(article) {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(article.replaceAll(" ", "_"))}`;
}

function formatDelta(milliseconds) {
  return `+${((milliseconds || 0) / 1000).toFixed(2)}`;
}

export function HopRail({ steps, target, phase, result, optimal }) {
  const railRef = useRef(null);
  const currentArticle = steps.at(-1)?.article || "";
  const targetReached = currentArticle.toLocaleLowerCase() === target.toLocaleLowerCase();
  const running = phase === "running";

  useEffect(() => {
    const rail = railRef.current;
    if (rail) rail.scrollTo({ top: rail.scrollHeight, behavior: "smooth" });
  }, [steps.length]);

  return (
    <ol ref={railRef} className="hop-rail" aria-label="All visited Wikipedia articles" aria-live="polite">
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;
        const isStart = step.hop === 0;
        const isFinish = isLast && targetReached;
        const delta = index > 0 ? step.elapsedMs - steps[index - 1].elapsedMs : 0;
        const classNames = [
          "hop",
          isStart ? "is-start" : "",
          isLast && !isFinish ? "is-current" : "",
          isFinish ? "is-finish" : "",
          isLast && running ? "is-live" : "",
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <li className={classNames} key={`${step.article}-${step.hop}`}>
            <span className="hop-index">{String(step.hop).padStart(2, "0")}</span>
            <span className="hop-marker">
              <i className="hop-dot">{isFinish && <Flag aria-hidden="true" size={9} />}</i>
            </span>
            <span className="hop-copy">
              <a className="hop-title" href={wikipediaUrl(step.article)} target="_blank" rel="noreferrer">
                {step.article}
              </a>
              <span className="hop-meta">
                {isStart ? (
                  <span className="hop-tag">START</span>
                ) : (
                  <>
                    {delta > 0 && <span className="hop-delta">{formatDelta(delta)}</span>}
                    <span className="hop-time">{formatCompact(step.elapsedMs)}</span>
                  </>
                )}
              </span>
            </span>
          </li>
        );
      })}

      {optimal && (
        <li className="hop is-optimal-route">
          <span className="hop-index">◆</span>
          <span className="hop-marker">
            <i className="hop-dot" />
          </span>
          <span className="hop-copy">
            <span className="hop-title">{optimal.path.join(" → ")}</span>
            <span className="hop-meta">
              <span className="hop-tag">BEST {optimal.depth}</span>
            </span>
          </span>
        </li>
      )}

      {!targetReached && steps.length > 0 && (
        <li className={`hop is-destination ${running ? "is-pending" : ""}`}>
          <span className="hop-index">··</span>
          <span className="hop-marker">
            <i className="hop-dot">
              <Target aria-hidden="true" size={9} />
            </i>
          </span>
          <span className="hop-copy">
            <span className="hop-title">{target}</span>
            <span className="hop-meta">
              <span className="hop-tag">
                {result === "max_hops" ? "NOT REACHED" : running ? "SEARCHING" : "DESTINATION"}
              </span>
            </span>
          </span>
        </li>
      )}
    </ol>
  );
}
