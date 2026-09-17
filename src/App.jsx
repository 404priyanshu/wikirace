import { RotateCcw, ShieldCheck, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { RaceLane } from "./components/RaceLane";
import { RaceSetup } from "./components/RaceSetup";
import { useRace } from "./hooks/useRace";

const DEFAULTS = {
  start: "Coffee",
  target: "Artificial intelligence",
  maxHops: 12,
};

function Brand() {
  return (
    <div className="brand">
      <span className="brand-glyph"><i>W</i><b>R</b></span>
      <span>
        <strong>WIKIRACE</strong>
        <small>AI NAVIGATION SHOWDOWN</small>
      </span>
    </div>
  );
}

export default function App() {
  const [start, setStart] = useState(DEFAULTS.start);
  const [target, setTarget] = useState(DEFAULTS.target);
  const [maxHops, setMaxHops] = useState(DEFAULTS.maxHops);
  const [keys, setKeys] = useState({ openai: true, typesafe: true });
  const { race, winner, startRace, resetRace } = useRace();
  const active = race.phase === "connecting" || race.phase === "running";

  useEffect(() => {
    fetch("/api/health")
      .then((response) => response.json())
      .then((payload) => setKeys(payload.keys))
      .catch(() => undefined);
  }, []);

  function reset() {
    resetRace();
    setStart(DEFAULTS.start);
    setTarget(DEFAULTS.target);
    setMaxHops(DEFAULTS.maxHops);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <Brand />
        <p className="tagline">TWO AI AGENTS. ONE MILLION LINKS. SAME DESTINATION.</p>
        <div className="top-actions">
          <span className={`race-badge race-badge--${race.phase}`}>
            <i />{" "}
            {active
              ? "RACE IN PROGRESS"
              : race.phase === "complete"
                ? "RACE COMPLETE"
                : race.phase === "error"
                  ? "RACE STOPPED"
                  : "READY"}
          </span>
          <button className="reset-button" type="button" onClick={reset}>
            <RotateCcw aria-hidden="true" size={14} /> RESET
          </button>
        </div>
      </header>

      <section className="control-deck" aria-label="Race controls">
        <RaceSetup
          start={start}
          target={target}
          maxHops={maxHops}
          onStartChange={setStart}
          onTargetChange={setTarget}
          onMaxHopsChange={setMaxHops}
          onStart={() => startRace({ start, target, maxHops })}
          disabled={active}
        />
        {(!keys.openai || !keys.typesafe) && (
          <p className="key-warning">
            <ShieldCheck aria-hidden="true" size={14} />
            {!keys.openai && "Add OPENAI_API_KEY to enable GPT-5.6 Sol. "}
            {!keys.typesafe && "Add TYPESAFE_API_KEY to enable Jev."}
          </p>
        )}
        {race.error && <p className="race-error">{race.error}</p>}
      </section>

      <section className="arena">
        <RaceLane
          agentId="gpt"
          label="GPT-5.6 SOL"
          subtitle="GENERAL REASONING MODEL"
          agent={race.agents.gpt}
          target={race.target}
          winner={winner === "gpt"}
        />
        <div className="versus" aria-hidden="true">
          <span>VS</span>
        </div>
        <RaceLane
          agentId="jev"
          label="JEV"
          subtitle="SYSTEM ONE NAVIGATOR"
          agent={race.agents.jev}
          target={race.target}
          winner={winner === "jev"}
        />
      </section>

      <footer className="race-footer">
        <div>
          <span>THE CHALLENGE</span>
          <strong>{race.start} <i>→</i> {race.target}</strong>
        </div>
        <p>
          <Zap aria-hidden="true" size={13} fill="currentColor" />
          SAME LINKS · SAME START · ZERO ARTIFICIAL DELAY
        </p>
        <div className="finish-mark" aria-label="Wikipedia finish line">
          <span>W</span>
          <strong>WIKIPEDIA<br /><small>THE FREE ENCYCLOPEDIA</small></strong>
        </div>
      </footer>
    </main>
  );
}
