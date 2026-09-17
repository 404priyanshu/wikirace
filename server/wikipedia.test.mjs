import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { resolveArticle } from "./wikipedia.mjs";

// wikiFetch resolves `fetch` from the global scope at call time, so stubbing the
// global here is enough — no module interception needed.
const realFetch = globalThis.fetch;

/** Responses wikiFetch will see, in order. Each test refills this. */
let queue = [];
/** Timestamp of every fetch attempt, used to assert how long the retry waited. */
let attempts = [];

function okBody() {
  return new Response(JSON.stringify({ query: { pages: { 1: { title: "Coffee" } } } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function throttled({ status, retryAfter }) {
  return new Response("rate limited", {
    status,
    headers: retryAfter === undefined ? {} : { "Retry-After": String(retryAfter) },
  });
}

/** Milliseconds between the last two attempts — i.e. what the retry actually waited. */
function waitedMs() {
  if (attempts.length < 2) return 0;
  return attempts.at(-1) - attempts.at(-2);
}

before(() => {
  globalThis.fetch = async (_url, init) => {
    attempts.push(Date.now());
    if (init?.signal?.aborted) {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    }
    const next = queue.shift();
    assert.ok(next, "wikiFetch made more attempts than the test queued");
    return next.status === 200 ? okBody() : throttled(next);
  };
});

after(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  queue = [];
  attempts = [];
});

describe("wikiFetch retry handling", () => {
  it("honours Retry-After given in seconds", async () => {
    // 3s, not 1s: the no-header backoff is itself ~1s, so a 1s header would pass
    // even if the header were ignored entirely.
    queue = [{ status: 429, retryAfter: 3 }, { status: 200 }];

    await resolveArticle("Coffee");

    assert.equal(attempts.length, 2);
    assert.ok(waitedMs() >= 2_900, `expected a ~3s wait, waited ${waitedMs()}ms`);
    assert.ok(waitedMs() < 3_500, `expected a ~3s wait, waited ${waitedMs()}ms`);
  });

  it("honours Retry-After given as an HTTP-date", async () => {
    // HTTP-date carries whole seconds only, so a now+3s deadline lands in (2000, 3000]ms.
    // That stays clear of the ~1s no-header backoff, so a pass really does mean the date parsed.
    queue = [
      { status: 429, retryAfter: new Date(Date.now() + 3_000).toUTCString() },
      { status: 200 },
    ];

    await resolveArticle("Coffee");

    assert.equal(attempts.length, 2);
    assert.ok(waitedMs() > 1_900, `expected a 2-3s wait, waited ${waitedMs()}ms`);
    assert.ok(waitedMs() <= 3_300, `expected a 2-3s wait, waited ${waitedMs()}ms`);
  });

  it("fails fast when Retry-After exceeds the cap, reporting the wait", async () => {
    queue = [{ status: 429, retryAfter: 300 }];
    const startedAt = Date.now();

    await assert.rejects(resolveArticle("Coffee"), /rate limiting this client.+about 300s/);

    assert.equal(attempts.length, 1, "should not retry past the cap");
    assert.ok(Date.now() - startedAt < 250, "should not sleep before giving up");
  });

  it("reports the wait from an over-cap HTTP-date too", async () => {
    queue = [{ status: 429, retryAfter: new Date(Date.now() + 60_000).toUTCString() }];

    await assert.rejects(resolveArticle("Coffee"), /rate limiting this client.+about (59|60)s/);

    assert.equal(attempts.length, 1);
  });

  it("backs off on its own when no Retry-After is sent", async () => {
    queue = [{ status: 429 }, { status: 200 }];

    await resolveArticle("Coffee");

    assert.equal(attempts.length, 2);
    assert.ok(waitedMs() >= 950, `expected the ~1s base backoff, waited ${waitedMs()}ms`);
    assert.ok(waitedMs() < 1_600, `expected the ~1s base backoff, waited ${waitedMs()}ms`);
  });

  it("ignores an unparseable Retry-After and backs off instead", async () => {
    queue = [{ status: 429, retryAfter: "soon" }, { status: 200 }];

    await resolveArticle("Coffee");

    assert.equal(attempts.length, 2);
    assert.ok(waitedMs() >= 950, `expected the ~1s base backoff, waited ${waitedMs()}ms`);
  });

  it("does not retry a non-retryable status", async () => {
    queue = [{ status: 404 }];
    const startedAt = Date.now();

    await assert.rejects(resolveArticle("Coffee"), /Wikipedia returned HTTP 404/);

    assert.equal(attempts.length, 1);
    assert.ok(Date.now() - startedAt < 250, "should not sleep before giving up");
  });

  it("retries 503 as well as 429", async () => {
    queue = [{ status: 503, retryAfter: 0 }, { status: 200 }];

    const title = await resolveArticle("Coffee");

    assert.equal(title, "Coffee");
    assert.equal(attempts.length, 2);
  });

  it("gives up after three attempts, surfacing the status", async () => {
    queue = [
      { status: 429, retryAfter: 0 },
      { status: 503, retryAfter: 0 },
      { status: 429, retryAfter: 0 },
    ];

    await assert.rejects(resolveArticle("Coffee"), /Wikipedia returned HTTP 429/);

    assert.equal(attempts.length, 3);
  });

  it("abandons the backoff promptly when the race is cancelled", async () => {
    queue = [{ status: 429, retryAfter: 10 }, { status: 200 }];
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const startedAt = Date.now();

    await assert.rejects(resolveArticle("Coffee", { signal: controller.signal }), /Race cancelled/);

    assert.ok(
      Date.now() - startedAt < 1_000,
      "should reject on abort rather than waiting out the 10s Retry-After",
    );
  });
});
