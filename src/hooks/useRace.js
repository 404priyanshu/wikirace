import { useCallback, useMemo, useRef, useState } from "react";

const initialAgent = {
  phase: "idle",
  status: "Waiting on the starting line",
  path: [],
  steps: [],
  hops: 0,
  calls: 0,
  modelMs: 0,
  elapsedMs: 0,
  fetchMs: 0,
  wallMs: 0,
  startedAt: null,
  result: null,
  error: "",
};

const initialState = {
  phase: "idle",
  start: "Coffee",
  target: "Artificial intelligence",
  maxHops: 12,
  startedAt: null,
  agents: { gpt: { ...initialAgent }, jev: { ...initialAgent } },
  error: "",
};

const CONNECT_FAILED = "Could not reach the race server. Check that it is running, then try again.";
const CONNECTION_LOST = "Lost connection to the race server before the race finished.";

/** Turn raw fetch/stream failures into wording that belongs in the UI. */
function describeError(error, streamOpen) {
  if (error instanceof TypeError) return streamOpen ? CONNECTION_LOST : CONNECT_FAILED;
  if (error instanceof SyntaxError) return "The race server sent a malformed update.";
  return error.message || "The race stopped unexpectedly.";
}

/** Freeze any agent still in flight so its clock stops and its lane shows the failure. */
function haltAgents(agents, message) {
  const stoppedAt = Date.now();
  return Object.fromEntries(
    Object.entries(agents).map(([agentId, agent]) => {
      if (agent.phase !== "running" && agent.phase !== "connecting") return [agentId, agent];
      return [
        agentId,
        {
          ...agent,
          phase: "error",
          status: "Race interrupted",
          error: message,
          elapsedMs: agent.startedAt ? stoppedAt - agent.startedAt : agent.elapsedMs,
        },
      ];
    }),
  );
}

function applyEvent(state, event) {
  if (event.type === "race_started") {
    return {
      ...state,
      phase: "running",
      start: event.start,
      target: event.target,
      maxHops: event.maxHops,
      startedAt: event.startedAt,
      error: "",
    };
  }
  if (event.type === "race_complete") return { ...state, phase: "complete" };
  if (event.type === "race_error") {
    const message = event.message || "The race stopped unexpectedly.";
    return {
      ...state,
      phase: "error",
      error: message,
      agents: haltAgents(state.agents, message),
    };
  }
  if (!event.agentId) return state;

  const agent = state.agents[event.agentId];
  let next = agent;
  if (event.type === "agent_started") {
    next = {
      ...initialAgent,
      phase: "running",
      status: "Scanning the first page",
      path: event.path,
      steps: event.path.map((article, index) => ({
        article,
        hop: index,
        elapsedMs: 0,
      })),
      startedAt: event.startedAt,
    };
  } else if (event.type === "agent_status") {
    next = { ...agent, status: event.status };
  } else if (event.type === "agent_call") {
    next = { ...agent, calls: event.calls, modelMs: event.modelMs };
  } else if (event.type === "agent_move") {
    next = {
      ...agent,
      status: `Moved to ${event.article}`,
      hops: event.hop,
      calls: event.calls,
      modelMs: event.modelMs,
      elapsedMs: event.elapsedMs,
      fetchMs: event.fetchMs,
      wallMs: event.wallMs,
      path: event.path,
      steps: [
        ...(agent.steps || []),
        {
          article: event.article,
          hop: event.hop,
          elapsedMs: event.elapsedMs,
        },
      ],
    };
  } else if (event.type === "agent_complete") {
    next = {
      ...agent,
      phase: "complete",
      status: event.result === "finished" ? "Target reached" : "Maximum hops reached",
      result: event.result,
      elapsedMs: event.elapsedMs,
      modelMs: event.modelMs,
      fetchMs: event.fetchMs,
      wallMs: event.wallMs,
      calls: event.calls,
      path: event.path,
      hops: Math.max(0, event.path.length - 1),
    };
  } else if (event.type === "agent_error") {
    next = {
      ...agent,
      phase: "error",
      status: "Unable to continue",
      error: event.message,
    };
  }
  return { ...state, agents: { ...state.agents, [event.agentId]: next } };
}

export function useRace() {
  const [race, setRace] = useState(initialState);
  const controllerRef = useRef(null);

  const startRace = useCallback(async ({ start, target, maxHops }) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setRace({
      ...initialState,
      phase: "connecting",
      start,
      target,
      maxHops,
      agents: {
        gpt: { ...initialAgent, phase: "connecting", status: "Taking the starting line" },
        jev: { ...initialAgent, phase: "connecting", status: "Taking the starting line" },
      },
    });

    let streamOpen = false;
    try {
      const response = await fetch("/api/race", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start, target, maxHops }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const payload = await response.json();
        throw new Error(payload.error || "The race could not start");
      }

      streamOpen = true;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          setRace((current) => applyEvent(current, event));
        }
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        const message = describeError(error, streamOpen);
        setRace((current) => ({
          ...current,
          phase: "error",
          error: message,
          agents: haltAgents(current.agents, message),
        }));
      }
    }
  }, []);

  const resetRace = useCallback(() => {
    controllerRef.current?.abort();
    setRace(initialState);
  }, []);

  const winner = useMemo(() => {
    const finished = Object.entries(race.agents)
      .filter(([, agent]) => agent.result === "finished")
      .sort((a, b) => a[1].elapsedMs - b[1].elapsedMs);
    return finished[0]?.[0] || null;
  }, [race.agents]);

  return { race, winner, startRace, resetRace };
}
