import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const ROUTES_PATH = path.join(dirname, "optimal-routes.json");
const MAX_LINKS = Number(process.env.MAX_LINKS || 255);

const norm = (title) => title.trim().replaceAll("_", " ").toLocaleLowerCase();

/**
 * Shortest routes precomputed by bench/shortest.mjs. A live search costs
 * minutes and hundreds of Wikipedia fetches, so the demo only shows an optimal
 * route for pairs it already knows; unknown pairs simply show nothing.
 */
function load() {
  try {
    const data = JSON.parse(fs.readFileSync(ROUTES_PATH, "utf8"));
    // Routes found under a different candidate cap describe a different graph.
    if (data.maxLinks !== MAX_LINKS) return {};
    return data.routes || {};
  } catch {
    return {};
  }
}

const routes = load();

export function optimalRoute(source, target) {
  return routes[`${norm(source)}|${norm(target)}`] || null;
}

export function optimalRouteCount() {
  return Object.keys(routes).length;
}
