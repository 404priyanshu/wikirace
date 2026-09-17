import { config } from "./config.mjs";

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;

/** ip -> timestamps of races started within the rolling hour. */
const perIp = new Map();
let dayStartedAt = Date.now();
let dayCount = 0;
let liveRaces = 0;

function rollDay(now) {
  if (now - dayStartedAt < DAY_MS) return;
  dayStartedAt = now;
  dayCount = 0;
}

/** Drop entries older than the rolling window, and forget IPs that fall empty. */
function prune(now) {
  for (const [ip, stamps] of perIp) {
    const fresh = stamps.filter((at) => now - at < HOUR_MS);
    if (fresh.length) perIp.set(ip, fresh);
    else perIp.delete(ip);
  }
}

export function clientIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded) return forwarded.split(",")[0].trim();
  return request.socket.remoteAddress || "unknown";
}

/**
 * Decide whether this request may start a race. On success the caller must
 * call the returned release() once the race ends, so the slot frees up.
 */
export function claimRaceSlot(ip) {
  const now = Date.now();
  rollDay(now);
  prune(now);

  if (liveRaces >= config.maxConcurrentRaces) {
    return { ok: false, status: 503, error: "Too many races running right now. Try again in a minute." };
  }
  if (dayCount >= config.maxRacesPerDay) {
    const hours = Math.ceil((dayStartedAt + DAY_MS - now) / HOUR_MS);
    return {
      ok: false,
      status: 429,
      error: `This demo's daily race budget is spent. It resets in about ${hours}h — or clone the repo and run it on your own keys.`,
    };
  }

  const stamps = perIp.get(ip) || [];
  if (stamps.length >= config.maxRacesPerIpPerHour) {
    const minutes = Math.max(1, Math.ceil((stamps[0] + HOUR_MS - now) / 60_000));
    return {
      ok: false,
      status: 429,
      error: `You've used all ${config.maxRacesPerIpPerHour} races for this hour. Try again in ${minutes} min.`,
    };
  }

  perIp.set(ip, [...stamps, now]);
  dayCount += 1;
  liveRaces += 1;

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

export function budgetStatus(ip) {
  const now = Date.now();
  rollDay(now);
  prune(now);
  const used = (perIp.get(ip) || []).length;
  return {
    racesLeftThisHour: Math.max(0, config.maxRacesPerIpPerHour - used),
    racesLeftToday: Math.max(0, config.maxRacesPerDay - dayCount),
    racesRunning: liveRaces,
  };
}
