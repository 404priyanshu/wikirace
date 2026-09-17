# WikiRace — AI Showdown

A live, screen-recording-ready Wikipedia race between GPT-5.6 Sol and Jev.

Both racers:

- begin at the same canonical Wikipedia article;
- may only choose links present on their current page;
- receive the same maximum candidate-set size and selection criteria;
- start concurrently with no artificial delay;
- expose wall-clock time, model-call time, hops, calls, and the route.

## Run locally

```bash
cd /Users/ainz/projects/wikirace
npm install
cp .env.example .env
# Add OPENAI_API_KEY to .env.
# TYPESAFE_API_KEY is optional here if it already exists in ~/.config/jev-browser/.env.
npm run dev
```

Open <http://127.0.0.1:4173>.

## Configuration

- `OPENAI_API_KEY` — required for GPT-5.6 Sol.
- `TYPESAFE_API_KEY` — required for Jev. The server also checks the existing jev-browser config at `~/.config/jev-browser/.env`.
- `PORT` — defaults to `4173`.

Public-demo guardrails (races run on the host's API keys):

- `MAX_RACES_PER_IP_PER_HOUR` — defaults to `3`.
- `MAX_RACES_PER_DAY` — defaults to `100`.
- `MAX_CONCURRENT_RACES` — defaults to `2`.
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — optional. Set both to keep
  per-IP and daily counts across restarts. Unset, the limits live in memory and
  reset with the process, which is fine locally but not on a host that sleeps.

Secrets remain on the server and are never sent to the browser.

## Tests

```bash
npm test
```

## Race format

Wikipedia article links come from the Action API's `action=parse&prop=links`, which returns the page's link list without the rendered HTML (~20x smaller). They are filtered to existing main-namespace articles and capped at 300 candidates per hop. Each model judges identical-size 60-link batches in parallel, then selects from the batch winners. A direct link to the target is followed without a model call.
