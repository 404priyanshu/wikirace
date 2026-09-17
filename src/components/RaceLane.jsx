import { Bot, BrainCircuit, ExternalLink, Flag, Route, Sparkles } from "lucide-react";
import { HopRail } from "./HopRail";
import { LiveTimer, formatCompact } from "./LiveTimer";

function AgentMark({ agentId }) {
  return agentId === "gpt" ? <BrainCircuit aria-hidden="true" /> : <Sparkles aria-hidden="true" />;
}

function wikipediaUrl(article) {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(article.replaceAll(" ", "_"))}`;
}

export function RaceLane({ agentId, label, subtitle, agent, target, winner }) {
  const running = agent.phase === "running";
  const steps =
    agent.steps ||
    agent.path.map((article, hop) => ({ article, hop, elapsedMs: agent.elapsedMs || 0 }));
  const hasPath = steps.length > 0;
  const completionLabel =
    agent.result === "max_hops"
      ? "LIMIT REACHED"
      : agent.phase === "complete"
        ? "FINISHED"
        : agent.phase.toUpperCase();
  return (
    <section className={`race-lane race-lane--${agentId} ${winner ? "is-winner" : ""}`}>
      <header className="lane-header">
        <span className="agent-mark"><AgentMark agentId={agentId} /></span>
        <span>
          <strong>{label}</strong>
          <small>{subtitle}</small>
        </span>
        <span className={`lane-state lane-state--${agent.phase}`}>
          <i />
          {winner ? "WINNER" : completionLabel}
        </span>
      </header>

      <div className="timer-wrap">
        <span className="timer-label">
          DECISION TIME
          <em>page loads excluded</em>
        </span>
        <div className="timer">
          <LiveTimer elapsedMs={agent.elapsedMs} />
        </div>
        <p className={`agent-status ${agent.phase === "error" ? "is-error" : ""}`}>
          <Bot aria-hidden="true" size={14} />
          {agent.error || agent.status}
        </p>
      </div>

      <div className="telemetry">
        <div>
          <span>HOPS</span>
          <strong>{String(agent.hops).padStart(2, "0")}</strong>
        </div>
        <div>
          <span>MODEL CALLS</span>
          <strong>{String(agent.calls).padStart(2, "0")}</strong>
        </div>
        <div>
          <span>PAGE WAIT</span>
          <strong>{formatCompact(agent.fetchMs)}</strong>
        </div>
      </div>

      <div className="route-heading">
        <span><Route aria-hidden="true" size={14} /> FULL LIVE ROUTE</span>
        <strong className="route-count">
          {String(agent.hops).padStart(2, "0")} <i>/</i> ALL HOPS
        </strong>
        {hasPath && (
          <a
            href={wikipediaUrl(agent.path.at(-1))}
            target="_blank"
            rel="noreferrer"
          >
            OPEN PAGE <ExternalLink aria-hidden="true" size={12} />
          </a>
        )}
      </div>
      {hasPath ? (
        <HopRail steps={steps} target={target} phase={agent.phase} result={agent.result} />
      ) : (
        <div className="empty-route">
          <Flag aria-hidden="true" size={17} />
          Route appears here when the race begins
        </div>
      )}
    </section>
  );
}
