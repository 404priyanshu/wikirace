import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { config } from "./config.mjs";
import { _resetMemory, budgetStatus, claimRaceSlot, clientIp } from "./rate-limit.mjs";

// Each test uses a distinct IP so per-IP windows stay independent.
let ipCounter = 0;
const nextIp = () => `10.0.0.${++ipCounter}`;

beforeEach(() => _resetMemory());

describe("race rate limiting", () => {
  it("allows up to the hourly per-IP cap, then refuses", async () => {
    const ip = nextIp();

    for (let i = 0; i < config.maxRacesPerIpPerHour; i += 1) {
      const slot = await claimRaceSlot(ip);
      assert.equal(slot.ok, true, `race ${i + 1} should be allowed`);
      slot.release();
    }

    const blocked = await claimRaceSlot(ip);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.status, 429);
    assert.match(blocked.error, /races for this hour/);
  });

  it("rolls the counter back when a request is refused", async () => {
    const ip = nextIp();
    for (let i = 0; i < config.maxRacesPerIpPerHour; i += 1) (await claimRaceSlot(ip)).release?.();

    await claimRaceSlot(ip);
    await claimRaceSlot(ip);

    // A rejected claim must not push the stored count past the cap, or the
    // daily budget would drain from traffic that never ran a race.
    const status = await budgetStatus(ip);
    assert.equal(status.racesLeftToday, config.maxRacesPerDay - config.maxRacesPerIpPerHour);
  });

  it("keeps per-IP budgets independent", async () => {
    const busy = nextIp();
    for (let i = 0; i < config.maxRacesPerIpPerHour; i += 1) (await claimRaceSlot(busy)).release?.();

    const fresh = await claimRaceSlot(nextIp());
    assert.equal(fresh.ok, true);
    fresh.release();
  });

  it("refuses once concurrent races are saturated, and recovers on release", async () => {
    const held = [];
    for (let i = 0; i < config.maxConcurrentRaces; i += 1) {
      const slot = await claimRaceSlot(nextIp());
      assert.equal(slot.ok, true);
      held.push(slot);
    }

    const blocked = await claimRaceSlot(nextIp());
    assert.equal(blocked.ok, false);
    assert.equal(blocked.status, 503);

    held.pop().release();
    const afterRelease = await claimRaceSlot(nextIp());
    assert.equal(afterRelease.ok, true);

    afterRelease.release();
    held.forEach((slot) => slot.release());
  });

  it("ignores a repeated release so one race frees only one slot", async () => {
    const slot = await claimRaceSlot(nextIp());
    slot.release();
    slot.release();
    slot.release();

    const held = [];
    for (let i = 0; i < config.maxConcurrentRaces; i += 1) {
      const next = await claimRaceSlot(nextIp());
      assert.equal(next.ok, true);
      held.push(next);
    }
    const blocked = await claimRaceSlot(nextIp());
    assert.equal(blocked.ok, false, "double release must not inflate capacity");
    held.forEach((s) => s.release());
  });

  it("reports the remaining hourly budget", async () => {
    const ip = nextIp();
    assert.equal((await budgetStatus(ip)).racesLeftThisHour, config.maxRacesPerIpPerHour);

    (await claimRaceSlot(ip)).release();
    assert.equal((await budgetStatus(ip)).racesLeftThisHour, config.maxRacesPerIpPerHour - 1);
  });

  it("prefers the first x-forwarded-for hop over the socket address", () => {
    const request = {
      headers: { "x-forwarded-for": "203.0.113.7, 70.41.3.18" },
      socket: { remoteAddress: "10.1.1.1" },
    };
    assert.equal(clientIp(request), "203.0.113.7");
  });

  it("falls back to the socket address without the header", () => {
    assert.equal(clientIp({ headers: {}, socket: { remoteAddress: "10.1.1.1" } }), "10.1.1.1");
    assert.equal(clientIp({ headers: {}, socket: {} }), "unknown");
  });
});

describe("redis-backed limiting", () => {
  // The redis store is selected at import time from config, so exercise it in a
  // child module registry with the env set and fetch stubbed.
  async function withFakeRedis(run) {
    const realFetch = globalThis.fetch;
    const realUrl = config.upstashUrl;
    const realToken = config.upstashToken;
    config.upstashUrl = "https://fake.upstash.io";
    config.upstashToken = "token";

    /** key -> count, standing in for Redis. */
    const data = new Map();
    const seen = [];
    globalThis.fetch = async (_url, init) => {
      const commands = JSON.parse(init.body);
      seen.push(commands);
      const results = commands.map(([verb, key]) => {
        if (verb === "INCR") {
          data.set(key, (data.get(key) || 0) + 1);
          return { result: data.get(key) };
        }
        if (verb === "DECR") {
          data.set(key, Math.max(0, (data.get(key) || 0) - 1));
          return { result: data.get(key) };
        }
        if (verb === "GET") return { result: data.get(key) || 0 };
        return { result: 1 }; // EXPIRE
      });
      return new Response(JSON.stringify(results), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    // Fresh module instance picks up the stubbed config.
    const mod = await import(`./rate-limit.mjs?redis=${Math.random()}`);
    try {
      await run(mod, { data, seen });
    } finally {
      globalThis.fetch = realFetch;
      config.upstashUrl = realUrl;
      config.upstashToken = realToken;
    }
  }

  it("reports redis persistence when configured", async () => {
    await withFakeRedis(async (mod) => {
      assert.equal(mod.persistence, "redis");
    });
  });

  it("enforces the hourly cap through redis and sets a TTL", async () => {
    await withFakeRedis(async (mod, { seen }) => {
      const ip = nextIp();
      for (let i = 0; i < config.maxRacesPerIpPerHour; i += 1) {
        const slot = await mod.claimRaceSlot(ip);
        assert.equal(slot.ok, true);
        slot.release();
      }

      const blocked = await mod.claimRaceSlot(ip);
      assert.equal(blocked.ok, false);
      assert.equal(blocked.status, 429);

      const verbs = seen.flat().map(([verb]) => verb);
      assert.ok(verbs.includes("EXPIRE"), "keys must expire or they leak forever");
      assert.ok(verbs.includes("DECR"), "a refused claim must roll its counter back");
    });
  });

  it("counts survive a process restart", async () => {
    await withFakeRedis(async (mod, { data }) => {
      const ip = nextIp();
      (await mod.claimRaceSlot(ip)).release();

      // Same backing store, brand new module instance == restarted process.
      const restarted = await import(`./rate-limit.mjs?restart=${Math.random()}`);
      const status = await restarted.budgetStatus(ip);

      assert.equal(status.racesLeftThisHour, config.maxRacesPerIpPerHour - 1);
      assert.ok(data.size > 0);
    });
  });

  it("fails closed when redis is unreachable", async () => {
    await withFakeRedis(async (mod) => {
      globalThis.fetch = async () => new Response("nope", { status: 500 });

      const slot = await mod.claimRaceSlot(nextIp());
      assert.equal(slot.ok, false);
      assert.equal(slot.status, 503);
      assert.match(slot.error, /Rate limiter unavailable/);
    });
  });

  it("frees the concurrency slot when redis fails", async () => {
    await withFakeRedis(async (mod) => {
      globalThis.fetch = async () => new Response("nope", { status: 500 });
      for (let i = 0; i < config.maxConcurrentRaces + 2; i += 1) {
        const slot = await mod.claimRaceSlot(nextIp());
        assert.equal(slot.status, 503);
        assert.match(slot.error, /Rate limiter unavailable/, "must not degrade into a concurrency refusal");
      }
    });
  });
});
