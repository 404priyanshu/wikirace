import { config } from "./config.mjs";

const HOUR_S = 60 * 60;
const DAY_S = 24 * HOUR_S;

/**
 * Counters live in fixed windows keyed by bucket index, so a key expires on its
 * own and nothing has to be swept. Redis keeps them across restarts; the
 * in-memory store is the local-dev fallback and resets with the process.
 */
const hourBucket = () => Math.floor(Date.now() / 1_000 / HOUR_S);
const dayBucket = () => Math.floor(Date.now() / 1_000 / DAY_S);

const ipKey = (ip) => `wikirace:ip:${ip}:${hourBucket()}`;
const dayKey = () => `wikirace:day:${dayBucket()}`;

/** Seconds until the current window rolls over, for user-facing wait times. */
const secondsLeftInHour = () => (hourBucket() + 1) * HOUR_S - Math.floor(Date.now() / 1_000);
const secondsLeftInDay = () => (dayBucket() + 1) * DAY_S - Math.floor(Date.now() / 1_000);

// Concurrency is per-process on purpose: a restart means no races are in flight,
// so persisting it would only ever leak phantom slots.
let liveRaces = 0;

const memory = new Map();

const memoryStore = {
  async bump(keys) {
    return keys.map(({ key }) => {
      const next = (memory.get(key) || 0) + 1;
      memory.set(key, next);
      return next;
    });
  },
  async undo(keys) {
    for (const { key } of keys) memory.set(key, Math.max(0, (memory.get(key) || 0) - 1));
  },
  async read(keys) {
    return keys.map(({ key }) => memory.get(key) || 0);
  },
};

async function upstash(commands) {
  const response = await fetch(`${config.upstashUrl}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.upstashToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(`Upstash returned HTTP ${response.status}`);
  }
  return (await response.json()).map((entry) => Number(entry.result) || 0);
}

const redisStore = {
  /** INCR then EXPIRE per key, in one round trip. Returns the new counts. */
  async bump(keys) {
    const results = await upstash(
      keys.flatMap(({ key, ttl }) => [
        ["INCR", key],
        ["EXPIRE", key, String(ttl), "NX"],
      ]),
    );
    // Results interleave INCR/EXPIRE; keep only the INCR values.
    return keys.map((_, index) => results[index * 2]);
  },
  async undo(keys) {
    await upstash(keys.map(({ key }) => ["DECR", key]));
  },
  async read(keys) {
    const results = await upstash(keys.map(({ key }) => ["GET", key]));
    return keys.map((_, index) => results[index]);
  },
};

const store = config.upstashUrl && config.upstashToken ? redisStore : memoryStore;

export const persistence = store === redisStore ? "redis" : "memory";

export function clientIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded) return forwarded.split(",")[0].trim();
  return request.socket.remoteAddress || "unknown";
}

function windowKeys(ip) {
  return [
    { key: ipKey(ip), ttl: HOUR_S },
    { key: dayKey(), ttl: DAY_S },
  ];
}

/**
 * Decide whether this request may start a race. On success the caller must call
 * the returned release() once the race ends, so the concurrency slot frees up.
 *
 * Counters are incremented first and rolled back when over budget: under a race
 * between two requests that refuses slightly early rather than overspending.
 */
export async function claimRaceSlot(ip) {
  if (liveRaces >= config.maxConcurrentRaces) {
    return { ok: false, status: 503, error: "Too many races running right now. Try again in a minute." };
  }
  liveRaces += 1;

  const keys = windowKeys(ip);
  let ipCount;
  let dayCount;
  try {
    [ipCount, dayCount] = await store.bump(keys);
  } catch (error) {
    liveRaces -= 1;
    return { ok: false, status: 503, error: `Rate limiter unavailable: ${error.message}` };
  }

  const overIp = ipCount > config.maxRacesPerIpPerHour;
  const overDay = dayCount > config.maxRacesPerDay;
  if (overIp || overDay) {
    liveRaces -= 1;
    await store.undo(keys).catch(() => undefined);
    return overDay
      ? {
          ok: false,
          status: 429,
          error: `This demo's daily race budget is spent. It resets in about ${Math.ceil(secondsLeftInDay() / HOUR_S)}h — or clone the repo and run it on your own keys.`,
        }
      : {
          ok: false,
          status: 429,
          error: `You've used all ${config.maxRacesPerIpPerHour} races for this hour. Try again in ${Math.max(1, Math.ceil(secondsLeftInHour() / 60))} min.`,
        };
  }

  let released = false;
  return {
    ok: true,
    release() {
      if (released) return;
      released = true;
      liveRaces = Math.max(0, liveRaces - 1);
    },
  };
}

export async function budgetStatus(ip) {
  try {
    const [ipCount, dayCount] = await store.read(windowKeys(ip));
    return {
      racesLeftThisHour: Math.max(0, config.maxRacesPerIpPerHour - ipCount),
      racesLeftToday: Math.max(0, config.maxRacesPerDay - dayCount),
      racesRunning: liveRaces,
      persistence,
    };
  } catch {
    return { racesRunning: liveRaces, persistence, unavailable: true };
  }
}

/** Test seam: drop in-memory counters between cases. */
export function _resetMemory() {
  memory.clear();
  liveRaces = 0;
}
