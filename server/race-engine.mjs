import { chooseWithGpt, chooseWithJev } from "./models.mjs";
import { getArticle, resolveArticle } from "./wikipedia.mjs";

const BATCH_SIZE = 60;
const MAX_LINKS = 300;

const agents = {
  gpt: { choose: chooseWithGpt },
  jev: { choose: chooseWithJev },
};

function normalize(title) {
  return title.trim().replaceAll("_", " ").toLocaleLowerCase();
}

function chunk(items, size) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, index * size + size),
  );
}

async function selectLink({ agentId, current, target, links, emit, signal }) {
  if (signal.aborted) throw new Error("Race cancelled");
  const direct = links.find((link) => normalize(link) === normalize(target));
  if (direct) {
    emit({ type: "agent_status", agentId, status: "Target link found on page" });
    return { choice: direct, calls: 0, modelMs: 0 };
  }

  const choose = agents[agentId].choose;
  const batches = chunk(links.slice(0, MAX_LINKS), BATCH_SIZE);
  if (!batches.length) throw new Error("No eligible Wikipedia links found");

  let calls = 0;
  let modelMs = 0;
  emit({
    type: "agent_status",
    agentId,
    status: `Judging ${batches.length} link sets in parallel`,
  });
  const finalists = await Promise.all(
    batches.map(async (batch) => {
      const result = await choose({ current, target, choices: batch });
      calls += 1;
      modelMs += result.elapsedMs;
      emit({ type: "agent_call", agentId, calls, modelMs });
      return result.choice;
    }),
  );

  if (finalists.length === 1) return { choice: finalists[0], calls, modelMs };

  emit({ type: "agent_status", agentId, status: "Choosing the strongest route" });
  const final = await choose({ current, target, choices: finalists });
  calls += 1;
  modelMs += final.elapsedMs;
  emit({ type: "agent_call", agentId, calls, modelMs });
  return { choice: final.choice, calls, modelMs };
}

async function runAgent({ agentId, start, target, maxHops, emit, signal }) {
  const startedAt = performance.now();
  let current = start;
  let calls = 0;
  let modelMs = 0;
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
      calls: 0,
      path,
    });
    return;
  }

  for (let hop = 1; hop <= maxHops; hop += 1) {
    if (signal.aborted) throw new Error("Race cancelled");
    emit({ type: "agent_status", agentId, status: `Reading ${current}` });
    const page = await getArticle(current, { signal });
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
    modelMs += selected.modelMs;
    current = selected.choice;
    visited.add(normalize(current));
    path.push(current);

    const elapsedMs = performance.now() - startedAt;
    emit({
      type: "agent_move",
      agentId,
      article: current,
      hop,
      calls,
      modelMs,
      elapsedMs,
      path,
    });

    if (normalize(current) === normalize(target)) {
      emit({
        type: "agent_complete",
        agentId,
        result: "finished",
        elapsedMs,
        modelMs,
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
    elapsedMs: performance.now() - startedAt,
    modelMs,
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
