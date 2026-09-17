import * as cheerio from "cheerio";

const WIKI_API = "https://en.wikipedia.org/w/api.php";
const USER_AGENT = "WikiRaceDemo/1.0 (local demo; fair AI navigation benchmark)";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1_000;
// Wikipedia typically asks for 15-25s when it throttles, so absorb that rather than failing the race.
// Past this, waiting would stall longer than it is worth; fail with the wait time instead.
const RETRY_AFTER_CAP_MS = 30_000;
const RETRYABLE_STATUS = new Set([429, 503]);
const pageCache = new Map();

function apiUrl(params) {
  const url = new URL(WIKI_API);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  url.searchParams.set("origin", "*");
  url.searchParams.set("format", "json");
  return url;
}

/**
 * Retry-After is either delta-seconds ("120") or an HTTP-date.
 * Returns the wait in milliseconds, or null when the header is absent or unusable.
 */
function parseRetryAfter(headerValue) {
  const trimmed = headerValue?.trim();
  if (!trimmed) return null;

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);

  const deadline = Date.parse(trimmed);
  if (Number.isNaN(deadline)) return null;
  return Math.max(0, deadline - Date.now());
}

/** A sleep that gives up promptly when the race is cancelled. */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Race cancelled"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Race cancelled"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function wikiFetch(params, { signal } = {}) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const response = await fetch(apiUrl(params), {
      headers: { "User-Agent": USER_AGENT },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (response.ok) return response.json();

    const isLastAttempt = attempt === MAX_ATTEMPTS - 1;
    if (!RETRYABLE_STATUS.has(response.status) || isLastAttempt) {
      throw new Error(`Wikipedia returned HTTP ${response.status}`);
    }

    const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
    if (retryAfterMs !== null && retryAfterMs > RETRY_AFTER_CAP_MS) {
      throw new Error(
        `Wikipedia is rate limiting this client. Try again in about ${Math.ceil(retryAfterMs / 1_000)}s.`,
      );
    }

    // Release the socket before waiting; nothing here reads a retryable response body.
    await response.body?.cancel().catch(() => undefined);

    // Honour the server's own pacing when it offers one, else back off exponentially with jitter.
    const waitMs = retryAfterMs ?? BASE_BACKOFF_MS * 2 ** attempt + Math.random() * 250;
    await sleep(waitMs, signal);
  }
  throw new Error("Wikipedia request failed");
}

export async function searchArticles(query, limit = 7) {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const payload = await wikiFetch({
    action: "opensearch",
    search: trimmed,
    limit: String(limit),
    namespace: "0",
  });
  return (payload[1] || []).map((title, index) => ({
    title,
    description: payload[2]?.[index] || "",
  }));
}

export async function resolveArticle(title, { signal } = {}) {
  const payload = await wikiFetch(
    {
      action: "query",
      titles: title.trim(),
      redirects: "1",
    },
    { signal },
  );
  const page = Object.values(payload.query?.pages || {})[0];
  if (!page || page.missing !== undefined) {
    throw new Error(`Wikipedia article “${title}” was not found`);
  }
  return page.title;
}

function isArticleLink(href) {
  if (!href?.startsWith("/wiki/")) return false;
  const raw = href.slice(6).split("#")[0].split("?")[0];
  if (!raw || raw.includes(":")) return false;
  return !raw.startsWith("Main_Page");
}

export async function getArticle(title, { signal } = {}) {
  const requestedTitle = title.trim();
  if (pageCache.has(requestedTitle)) return pageCache.get(requestedTitle);

  const promise = (async () => {
    const payload = await wikiFetch(
      {
        action: "parse",
        page: requestedTitle,
        prop: "text",
        redirects: "1",
        formatversion: "2",
      },
      { signal },
    );
    const canonical = payload.parse?.title || requestedTitle;
    pageCache.set(canonical, promise);
    const html = payload.parse?.text;
    if (!html) throw new Error(`Could not read Wikipedia article “${canonical}”`);

    const $ = cheerio.load(html);
    const links = [];
    const seen = new Set([canonical.toLowerCase()]);
    $(".mw-parser-output a").each((_, element) => {
      const href = $(element).attr("href");
      if (!isArticleLink(href)) return;
      const slug = href.slice(6).split("#")[0].split("?")[0];
      let linkedTitle;
      try {
        linkedTitle = decodeURIComponent(slug).replaceAll("_", " ");
      } catch {
        return;
      }
      const key = linkedTitle.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      links.push(linkedTitle);
    });

    return { title: canonical, links };
  })();

  pageCache.set(requestedTitle, promise);
  try {
    return await promise;
  } catch (error) {
    pageCache.delete(requestedTitle);
    throw error;
  }
}
