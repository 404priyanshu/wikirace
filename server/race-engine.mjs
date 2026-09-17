import { chooseWithGpt, chooseWithJev } from "./models.mjs";
import { getArticle, resolveArticle } from "./wikipedia.mjs";

// Jev accepts at most 255 choices per question, so that is the shared ceiling.
// Both racers see the same first N links in the order the page renders them,
// which is what a person scanning the article from the top would meet first.
const MAX_LINKS = Number(process.env.MAX_LINKS || 255);

const agents = {
  gpt: { choose: chooseWithGpt },
  jev: { choose: chooseWithJev },
};

function normalize(title) {
  return title.trim().replaceAll("_", " ").toLocaleLowerCase();
}

async function selectLink({ agentId, current, target, links, emit, signal }) {
  if (signal.aborted) throw new Error("Race cancelled");
  const direct = links.find((link) => normalize(link) === normalize(target));
  if (direct) {
    emit({ type: "agent_status", agentId, status: "Target link found on page" });
    return { choice: direct, calls: 0, modelMs: 0, retries: 0 };
  }

  const choices = links.slice(0, MAX_LINKS);
  if (!choices.length) throw new Error("No eligible Wikipedia links found");

  // One judgment per hop, over the identical candidate list for both racers.
  // Splitting into batches would inflate the call count and turn a per-call
  // latency difference into a wall-clock difference that the batching invented.
  emit({ type: "agent_status", agentId, status: `Judging ${choices.length} links` });
  const result = await agents[agentId].choose({ current, target, choices });
  emit({ type: "agent_call", agentId, calls: 1, modelMs: result.elapsedMs });
  return {
    choice: result.choice,
    calls: 1,
    modelMs: result.elapsedMs,
    retries: result.retries || 0,
  };
}

async function runAgent({ agentId, start, target, maxHops, emit, signal }) {
  const startedAt = performance.now();
  let current = start;
  let calls = 0;
  // The race clock. Only time spent deciding counts: page loads are the
  // environment, identical for both racers and dominated by Wikipedia's mood.
  // They are measured separately so the cost stays visible without scoring it.
  let decisionMs = 0;
  let fetchMs = 0;
  let retries = 0;
  const path = [start];
  const visited = new Set([normalize(start)]);

  emit({ type: "agent_started", agentId, startedAt: Date.now(), path });

  if (normalize(start) === normalize(target)) {
    emit({
      type: "agent_complete",
      agentId,
      result: "finished",
      elapsedMs: 0,
      modelMs: 0,
      fetchMs: 0,
      wallMs: 0,
      calls: 0,
      path,
    });
    return;
  }

  for (let hop = 1; hop <= maxHops; hop += 1) {
    if (signal.aborted) throw new Error("Race cancelled");
    emit({ type: "agent_status", agentId, status: `Reading ${current}` });
    const fetchStartedAt = performance.now();
    const page = await getArticle(current, { signal });
    fetchMs += performance.now() - fetchStartedAt;
    const eligible = page.links.filter((link) => !visited.has(normalize(link)));
    const selected = await selectLink({
      agentId,
      current: page.title,
      target,
      links: eligible,
      emit,
      signal,
    });
    calls += selected.calls;
    decisionMs += selected.modelMs;
    retries += selected.retries;
    current = selected.choice;
    visited.add(normalize(current));
    path.push(current);

    emit({
      type: "agent_move",
      agentId,
      article: current,
      hop,
      calls,
      modelMs: decisionMs,
      elapsedMs: decisionMs,
      fetchMs,
      retries,
      wallMs: performance.now() - startedAt,
      path,
    });

    if (normalize(current) === normalize(target)) {
      emit({
        type: "agent_complete",
        agentId,
        result: "finished",
        elapsedMs: decisionMs,
        modelMs: decisionMs,
        fetchMs,
        retries,
        wallMs: performance.now() - startedAt,
        calls,
        path,
      });
      return;
    }
  }

  emit({
    type: "agent_complete",
    agentId,
    result: "max_hops",
    elapsedMs: decisionMs,
    modelMs: decisionMs,
    fetchMs,
    retries,
    wallMs: performance.now() - startedAt,
    calls,
    path,
  });
}

export async function runRace({ start, target, maxHops, emit, signal }) {
  const [canonicalStart, canonicalTarget] = await Promise.all([
    resolveArticle(start, { signal }),
    resolveArticle(target, { signal }),
  ]);
  await getArticle(canonicalStart, { signal });

  emit({
    type: "race_started",
    start: canonicalStart,
    target: canonicalTarget,
    maxHops,
    startedAt: Date.now(),
  });

  const settled = await Promise.allSettled(
    Object.keys(agents).map(async (agentId) => {
      try {
        await runAgent({
          agentId,
          start: canonicalStart,
          target: canonicalTarget,
          maxHops,
          emit,
          signal,
        });
      } catch (error) {
        emit({
          type: "agent_error",
          agentId,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }),
  );

  emit({
    type: "race_complete",
    finishedAt: Date.now(),
    ok: settled.some((result) => result.status === "fulfilled"),
  });
}
