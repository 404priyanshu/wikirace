import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { config } from "./config.mjs";
import { budgetStatus, claimRaceSlot, clientIp } from "./rate-limit.mjs";

// Each test uses a distinct IP so the per-IP buckets stay independent.
let ipCounter = 0;
const nextIp = () => `10.0.0.${++ipCounter}`;

describe("race rate limiting", () => {
  it("allows up to the hourly per-IP cap, then refuses", () => {
    const ip = nextIp();

    for (let i = 0; i < config.maxRacesPerIpPerHour; i += 1) {
      const slot = claimRaceSlot(ip);
      assert.equal(slot.ok, true, `race ${i + 1} should be allowed`);
      slot.release();
    }

    const blocked = claimRaceSlot(ip);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.status, 429);
    assert.match(blocked.error, /races for this hour/);
  });

  it("keeps per-IP budgets independent", () => {
    const busy = nextIp();
    for (let i = 0; i < config.maxRacesPerIpPerHour; i += 1) claimRaceSlot(busy).release?.();

    const fresh = claimRaceSlot(nextIp());
    assert.equal(fresh.ok, true);
    fresh.release();
  });

  it("refuses once concurrent races are saturated, and recovers on release", () => {
    const held = [];
    for (let i = 0; i < config.maxConcurrentRaces; i += 1) {
      const slot = claimRaceSlot(nextIp());
      assert.equal(slot.ok, true);
      held.push(slot);
    }

    const blocked = claimRaceSlot(nextIp());
    assert.equal(blocked.ok, false);
    assert.equal(blocked.status, 503);

    held.pop().release();
    const afterRelease = claimRaceSlot(nextIp());
    assert.equal(afterRelease.ok, true);

    afterRelease.release();
    held.forEach((slot) => slot.release());
  });

  it("ignores a repeated release so one race frees only one slot", () => {
    const slot = claimRaceSlot(nextIp());
    slot.release();
    slot.release();
    slot.release();

    const held = [];
    for (let i = 0; i < config.maxConcurrentRaces; i += 1) {
      const next = claimRaceSlot(nextIp());
      assert.equal(next.ok, true);
      held.push(next);
    }
    assert.equal(claimRaceSlot(nextIp()).ok, false, "double release must not inflate capacity");
    held.forEach((s) => s.release());
  });

  it("reports the remaining hourly budget", () => {
    const ip = nextIp();
    assert.equal(budgetStatus(ip).racesLeftThisHour, config.maxRacesPerIpPerHour);

    claimRaceSlot(ip).release();
    assert.equal(budgetStatus(ip).racesLeftThisHour, config.maxRacesPerIpPerHour - 1);
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
