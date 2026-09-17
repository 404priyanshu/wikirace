/**
 * Shortest path between two articles *in the graph the racers actually see*.
 *
 * This is deliberately not Six Degrees of Wikipedia. That runs BFS over a full
 * SQL dump, counting every link including templates and navboxes at some past
 * snapshot. The racers see live rendered HTML, main namespace only, capped at
 * MAX_LINKS per page in render order. Those are different graphs: on
 * Coffee -> Bennett, not one edge of the dump's 5-hop optimum exists here.
 * Scoring the racers against the dump would understate them on every pair.
 *
 * Strategy. Forward expansion is expensive (one HTML fetch per node) so it is
 * used sparingly; the backward side uses list=backlinks, which is cheap but
 * describes Wikipedia's graph rather than ours. Every backlink edge is
 * therefore re-verified with a real fetch before it is allowed into a path.
 *
 *   depth 1  target in links(source)
 *   depth 2  some m in links(source) with target in links(m)
 *   depth 3  some m1 in links(source), m2 in links(m1), target in links(m2)
 *
 * Beyond depth 3 the fetch cost explodes (255^3 nodes), so the search stops and
 * says so rather than guessing. Results carry `exact: false` when a budget or
 * the depth limit cut the search short.
 *
 * Usage:
 *   node --env-file=.env bench/shortest.mjs "Coffee" "Artificial intelligence"
 *   node --env-file=.env bench/shortest.mjs --score bench/results-gpt-none.json
 */
import fs from "node:fs";
import { getArticle, resolveArticle, wikiFetch } from "../server/wikipedia.mjs";

const MAX_LINKS = Number(process.env.MAX_LINKS || 255);
const FETCH_BUDGET = Number(process.env.SHORTEST_FETCH_BUDGET || 400);

const norm = (title) => title.trim().replaceAll("_", " ").toLocaleLowerCase();

let fetches = 0;
const linkCache = new Map();

/** The racers' edge rule: first MAX_LINKS main-namespace links, in page order. */
async function edgesFrom(title) {
  const key = norm(title);
  if (linkCache.has(key)) return linkCache.get(key);
  if (fetches >= FETCH_BUDGET) return null;
  fetches += 1;
  const page = await getArticle(title);
  const links = page.links.slice(0, MAX_LINKS);
  linkCache.set(key, links);
  return links;
}

/**
 * Pages Wikipedia says link to `title`. Cheap, but it is Wikipedia's graph, not
 * ours, so callers must verify each edge with edgesFrom before trusting it.
 */
async function backlinks(title, limit = 5000) {
  const found = [];
  let cont;
  do {
    // Through wikiFetch so this honours Retry-After like every other call.
    const payload = await wikiFetch({
      action: "query",
      list: "backlinks",
      bltitle: title,
      blnamespace: "0",
      bllimit: "500",
      blfilterredir: "all",
      ...(cont ? { blcontinue: cont } : {}),
    });
    for (const entry of payload.query?.backlinks || []) found.push(entry.title);
    cont = payload.continue?.blcontinue;
  } while (cont && found.length < limit);
  return new Set(found.map(norm));
}


export async function shortestPath(sourceRaw, targetRaw) {
  const source = await resolveArticle(sourceRaw);
  const target = await resolveArticle(targetRaw);
  fetches = 0;

  if (norm(source) === norm(target)) return { source, target, depth: 0, path: [source], exact: true, fetches };

  const first = await edgesFrom(source);
  if (!first) return { source, target, depth: null, path: null, exact: false, fetches, reason: "budget" };

  // Depth 1.
  const direct = first.find((l) => norm(l) === norm(target));
  if (direct) return { source, target, depth: 1, path: [source, target], exact: true, fetches };

  // Backward candidate set, verified before use.
  const inbound = await backlinks(target);

  // Depth 2: a first-hop node that genuinely links to the target.
  for (const mid of first) {
    if (!inbound.has(norm(mid))) continue;
    const midLinks = await edgesFrom(mid);
    if (!midLinks) break;
    if (midLinks.some((l) => norm(l) === norm(target))) {
      return { source, target, depth: 2, path: [source, mid, target], exact: true, fetches };
    }
  }

  // Depth 3: first-hop node -> a verified inbound neighbour of the target.
  let truncated = false;
  for (const mid1 of first) {
    const mid1Links = await edgesFrom(mid1);
    if (!mid1Links) {
      truncated = true;
      break;
    }
    for (const mid2 of mid1Links) {
      if (!inbound.has(norm(mid2))) continue;
      const mid2Links = await edgesFrom(mid2);
      if (!mid2Links) {
        truncated = true;
        break;
      }
      if (mid2Links.some((l) => norm(l) === norm(target))) {
        return { source, target, depth: 3, path: [source, mid1, mid2, target], exact: true, fetches };
      }
    }
    if (truncated) break;
  }

  return {
    source,
    target,
    depth: null,
    path: null,
    // A clean depth-3 exhaustion still proves the answer is >3; a truncated one proves nothing.
    exact: !truncated,
    atLeast: truncated ? null : 4,
    fetches,
    reason: truncated ? "budget" : "deeper than 3",
  };
}

async function scoreResults(file) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  console.log(`scoring ${file} (${data.summary.label})\n`);
  const scored = [];
  const gapMs = Number(process.env.SHORTEST_GAP_MS || 5_000);
  for (const [index, row] of data.rows.entries()) {
    if (index) await new Promise((r) => setTimeout(r, gapMs));
    const optimal = await shortestPath(row.start, row.target);
    const label = optimal.depth ?? (optimal.atLeast ? `>${optimal.atLeast - 1}` : "unknown");
    const line = ["gpt", "jev"]
      .map((id) => {
        const hops = row.agents[id].hops;
        if (!hops) return `${id}:-`;
        const over = typeof optimal.depth === "number" ? `${hops - optimal.depth >= 0 ? "+" : ""}${hops - optimal.depth}` : "?";
        return `${id}:${hops}h(${over})`;
      })
      .join("  ");
    console.log(`${row.start} -> ${row.target}: optimal=${label}  ${line}  [${optimal.fetches} fetches]`);
    scored.push({ start: row.start, target: row.target, optimal, gptHops: row.agents.gpt.hops, jevHops: row.agents.jev.hops });
  }
  const out = file.replace(/\.json$/, "-optimality.json");
  fs.writeFileSync(out, `${JSON.stringify(scored, null, 2)}\n`);
  console.log(`\nwrote ${out}`);
}

const args = process.argv.slice(2);
if (args[0] === "--score") {
  await scoreResults(args[1]);
} else if (args.length >= 2) {
  const result = await shortestPath(args[0], args[1]);
  console.log(JSON.stringify(result, null, 2));
} else {
  console.error('usage: shortest.mjs "Source" "Target"   |   shortest.mjs --score <results.json>');
  process.exit(1);
}
