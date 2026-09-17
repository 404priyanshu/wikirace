import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createServer as createViteServer } from "vite";
import { config, publicKeyStatus } from "./config.mjs";
import { runRace } from "./race-engine.mjs";
import { resolveArticle, searchArticles } from "./wikipedia.mjs";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dirname, "..");
const app = express();
app.use(express.json({ limit: "64kb" }));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, keys: publicKeyStatus() });
});

app.get("/api/articles/search", async (request, response) => {
  try {
    response.json({ results: await searchArticles(String(request.query.q || "")) });
  } catch (error) {
    response.status(502).json({ error: error.message });
  }
});

app.get("/api/articles/resolve", async (request, response) => {
  try {
    response.json({ title: await resolveArticle(String(request.query.title || "")) });
  } catch (error) {
    response.status(404).json({ error: error.message });
  }
});

app.post("/api/race", async (request, response) => {
  const { start, target } = request.body || {};
  const maxHops = Math.min(30, Math.max(1, Number(request.body?.maxHops || 12)));
  if (!start?.trim() || !target?.trim()) {
    return response.status(400).json({ error: "Start and target articles are required" });
  }

  response.status(200);
  response.setHeader("Content-Type", "application/x-ndjson");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("X-Accel-Buffering", "no");
  response.flushHeaders();

  let closed = false;
  const controller = new AbortController();
  request.on("aborted", () => {
    closed = true;
    controller.abort();
  });
  response.on("close", () => {
    if (!response.writableEnded) {
      closed = true;
      controller.abort();
    }
  });

  const emit = (event) => {
    if (!closed) response.write(`${JSON.stringify(event)}\n`);
  };

  try {
    await runRace({ start, target, maxHops, emit, signal: controller.signal });
  } catch (error) {
    emit({ type: "race_error", message: error.message });
  } finally {
    if (!closed) response.end();
  }
});

if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(root, "dist")));
  app.get("*splat", (_request, response) => {
    response.sendFile(path.join(root, "dist", "index.html"));
  });
} else {
  const vite = await createViteServer({
    root,
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

app.listen(config.port, "127.0.0.1", () => {
  console.log(`WikiRace ready at http://127.0.0.1:${config.port}`);
});
