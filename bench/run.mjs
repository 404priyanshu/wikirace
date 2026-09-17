import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// A benchmark can afford to sit out a Wikipedia throttle; the live app cannot.
// Must be set before the module reads it at import time.
process.env.WIKI_RETRY_AFTER_CAP_MS ||= "120000";

const { runRace } = await import("../server/race-engine.mjs");
const { config } = await import("../server/config.mjs");

const dirname = path.dirname(fileURLToPath(import.meta.url));

const PAIRS = [
  ["Coffee", "Artificial intelligence"],
  ["Sourdough", "Riemann hypothesis"],
  ["Bicycle", "Photosynthesis"],
  ["Jazz", "Plate tectonics"],
  ["Iceland", "Cryptography"],
  ["Origami", "Immune system"],
  ["Chess", "Antibiotic"],
  ["Lighthouse", "Genetics"],
  ["Pottery", "Black hole"],
  ["Tea", "Machine learning"],
  ["Volcano", "Linguistics"],
  ["Violin", "Vaccine"],
];

const MAX_HOPS = Number(process.env.BENCH_MAX_HOPS || 12);
const LABEL = process.env.BENCH_LABEL || `gpt-${config.gptReasoningEffort}`;
// Wikipedia throttles hard when races run back to back; pace between them.
const GAP_MS = Number(process.env.BENCH_GAP_MS || 30_000);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function blankAgent() {
  return { result: null, elapsedMs: 0, modelMs: 0, fetchMs: 0, retries: 0, calls: 0, hops: 0, path: [], error: "" };
}

async function race(start, target) {
  const agents = { gpt: blankAgent(), jev: blankAgent() };
  let raceError = "";

  await runRace({
    start,
    target,
    maxHops: MAX_HOPS,
    signal: new AbortController().signal,
    emit(event) {
      if (event.type === "race_error") raceError = event.message;
      const agent = agents[event.agentId];
      if (!agent) return;
      if (event.type === "agent_complete") {
        Object.assign(agent, {
          result: event.result,
          elapsedMs: event.elapsedMs,
          modelMs: event.modelMs,
          calls: event.calls,
          fetchMs: event.fetchMs,
          retries: event.retries,
          path: event.path,
          hops: Math.max(0, event.path.length - 1),
        });
      } else if (event.type === "agent_error") {
        agent.error = event.message;
      } else if (event.type === "agent_move") {
        agent.modelMs = event.modelMs;
        agent.calls = event.calls;
      }
    },
  });

  return { start, target, raceError, agents };
}

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

function summarise(rows, id) {
  const ran = rows.filter((r) => r.agents[id].result && !r.agents[id].error);
  const finished = ran.filter((r) => r.agents[id].result === "finished");
  return {
    attempted: rows.length,
    errored: rows.filter((r) => r.agents[id].error).length,
    finished: finished.length,
    finishRate: ran.length ? finished.length / ran.length : 0,
    medianSeconds: median(finished.map((r) => r.agents[id].elapsedMs)) / 1000,
    medianHops: median(finished.map((r) => r.agents[id].hops)),
    retries: rows.reduce((sum, r) => sum + (r.agents[id].retries || 0), 0),
    medianMsPerCall: median(
      ran.filter((r) => r.agents[id].calls > 0).map((r) => r.agents[id].modelMs / r.agents[id].calls),
    ),
  };
}

const rows = [];
for (const [index, [start, target]] of PAIRS.entries()) {
  process.stdout.write(`[${index + 1}/${PAIRS.length}] ${start} -> ${target} ... `);
  try {
    const row = await race(start, target);
    rows.push(row);
    const line = ["gpt", "jev"]
      .map((id) => {
        const a = row.agents[id];
        if (a.error) return `${id}:ERR`;
        return `${id}:${a.result === "finished" ? `${(a.elapsedMs / 1000).toFixed(1)}s/${a.hops}h` : a.result}`;
      })
      .join("  ");
    console.log(line);
  } catch (error) {
    console.log(`FAILED: ${error.message}`);
    rows.push({ start, target, raceError: error.message, agents: { gpt: blankAgent(), jev: blankAgent() } });
  }
  if (index < PAIRS.length - 1) await sleep(GAP_MS);
}

// Head-to-head is only meaningful where both racers actually reached the target.
const bothFinished = rows.filter(
  (r) => r.agents.gpt.result === "finished" && r.agents.jev.result === "finished",
);
const jevWins = bothFinished.filter((r) => r.agents.jev.elapsedMs < r.agents.gpt.elapsedMs).length;

const summary = {
  ranAt: new Date().toISOString(),
  label: LABEL,
  gptReasoningEffort: config.gptReasoningEffort,
  maxLinks: Number(process.env.MAX_LINKS || 255),
  clock: "decision time only; page fetches excluded",
  maxHops: MAX_HOPS,
  pairs: PAIRS.length,
  bothFinished: bothFinished.length,
  jevFasterWhenBothFinished: jevWins,
  gptFasterWhenBothFinished: bothFinished.length - jevWins,
  gpt: summarise(rows, "gpt"),
  jev: summarise(rows, "jev"),
};

console.log(`\n${JSON.stringify(summary, null, 2)}`);

const outPath = path.join(dirname, `results-${LABEL}.json`);
fs.writeFileSync(outPath, `${JSON.stringify({ summary, rows }, null, 2)}\n`);
console.log(`\nwrote ${outPath}`);
