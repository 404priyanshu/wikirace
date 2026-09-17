# I Raced Two AI Models Through Wikipedia 24 Times. The Interesting Result Wasn't Who Won.

I built a small thing last week to settle an argument with myself, and spent most of the time discovering that my own benchmark was lying to me.

The game is Wikipedia racing. Start on one article, reach a target article, and you may only click links that exist on the page you're currently on. It's a clean test of one narrow skill: look at a few hundred options, know which one gets you closer.

Two racers. **GPT-5.6 Sol**, a general reasoning model, the kind most of us reach for by default. And **Jev**, TypeSafe's System One model — which doesn't write. It can't draft your email or tell you a story. Given a situation and a set of options, it returns one typed answer and a probability. That's the entire product surface.

Twelve start-target pairs. Then all twelve again with Sol's reasoning turned on, because "you disabled the model's main feature" is the first thing anyone would say, and they'd be right to.

## What happened

| | Sol (reasoning off) | Sol (reasoning low) | Jev |
|---|---|---|---|
| Races won on time | 0 of 12 | 0 of 12 | **24 of 24** |
| Median time per decision | 2.01s | 4.56s | **0.85–0.98s** |
| Median hops to target | 3 | 3 | **3** |
| Races completed | 12/12 | 12/12 | 12/12 each |

Jev won every race. Not most — all twenty-four. Sign test puts that at p = 0.0005.

But the number I'd actually point at is the third row. **Median hops: 3, 3, and 3.** Across 24 races the two models found routes of statistically indistinguishable quality. Sol took the shorter path in 7 races, Jev in 5, and they tied in 12.

This is not a story about one model navigating better. They navigate the same. One of them just does it two to five times faster per decision.

## The reasoning result

Here's the part I didn't expect. Turning Sol's reasoning from `none` up to `low`:

- **1.72x slower** — median decision time 5.43s → 9.35s
- **Zero navigation benefit** — 40 total hops became 41

More thinking, same routes. On this task the reasoning machinery is pure cost. Violin → Vaccine went from 5.97s to 21.18s and got *worse*, taking six hops instead of four.

So the "you hobbled GPT" objection doesn't survive contact with the data. Giving Sol its defining feature back makes it slower and no better. That's a stronger statement than any disclaimer I could have written.

## Why this took three attempts to measure

I'm including this because the wrong versions were more flattering, and because the mistakes are ones I'd bet are sitting in other people's benchmarks right now.

**My first harness ran a tournament.** It split each page's links into batches of 60, asked each model to pick a winner per batch, then ran finalist rounds — about 20 model calls per hop. That structure multiplies any per-call latency gap by the number of calls, so it *manufactured* Jev's advantage. It also let the best link on a page get eliminated in round one by a locally stronger neighbour. That's where "Jev navigates worse" came from. It was never true. It was my batching.

**My clock was timing Wikipedia.** Wall-clock time was 61–72% page fetches. Worse, both racers shared a page cache, so when they took the same route the second one awaited the *same in-flight request* as the first — and they finished on the identical millisecond. I had a screenshot of a "race" where both models showed exactly 25.90s while their actual decision times differed ninefold. The clock now counts only time spent deciding. Page waits are measured and reported, but not scored.

**My retries were asymmetric.** The OpenAI SDK retries failed requests by default. My Jev client didn't. When TypeSafe had a brief outage, six of twelve races died on Jev's side while Sol sailed through blips invisibly — and Sol's retry time was being counted as thinking time. Both now share one retry policy, and only the attempt that actually produced an answer is timed.

Every one of those bugs had a direction. Two flattered Jev, one flattered Sol. If I'd stopped at the first clean-looking run I'd have published a 4.1x latency claim and a "worse navigator wins" narrative, and both would have been artifacts of my own code.

## The part that actually matters

Go look at the AI features in your product. Not the chat box — the rest of it. Routing a ticket to a queue. Deciding whether a document needs human review. Reranking search results. Picking which of six workflows a request belongs to. Flagging a transaction for a second look.

None of those are writing tasks. Every one is a **judgment with a finite set of answers**.

Most of us implement them by prompting a generative model, hoping the JSON parses, and writing retry logic for when it doesn't. We reached for a text generator because that's what was on the shelf, then spent real engineering effort fighting the text back into a type.

That's the inversion Jev represents: the judgment is the primitive, and the generation is gone. Not a smaller LLM, not a cheaper one — a different shape of thing, one that drops into code the way a function call does, because a typed answer with a probability attached is something an `if` statement can consume.

And the hops result is what makes that interesting rather than merely fast. If the specialised model navigated *worse*, this would be the usual speed-for-quality trade. It didn't. Same routes, a fraction of the latency, on a task where the text was never doing any work.

## When to use which

**Reach for a reasoning model** when the output is prose a person will read, or the task genuinely needs multi-step planning. Note what this benchmark did *not* test: anything open-ended. On a bounded pick-one-of-255, reasoning bought nothing. That is not evidence it buys nothing elsewhere.

**Reach for a System One model** for bounded decisions at volume, inside workflows no human watches in real time. Once you start counting, that's most of the AI surface area in a working product.

The pairing is the obvious end state: typed judgments handling the volume, escalating to a reasoning model only when the probability comes back uncertain.

## What this is and isn't

Twenty-four races, one run per configuration. Enough to establish direction — 24/24 is not luck — and not enough to size the effect precisely. No repeat runs, so no variance estimate.

It's one task type, on a benchmark I wrote myself, against one competitor. Both racers see the same 255 candidates per hop, which is Jev's hard API ceiling applied equally; articles carry 520–1023 links, so both see roughly the top half of a page. Page-load time is excluded from the clock but Jev still benefits from a warm cache when Sol fetches first — it just doesn't score any more.

The code and the raw per-race JSON are public, including the broken earlier runs. Disagree with me using my own data.

But the thing that made me want to write this wasn't the stopwatch. It was noticing I'd spent two years reaching for a text generator every time I needed software to make up its mind, and had never once asked whether the text was doing any work.

Usually, it isn't.

---

*Built on the TypeSafe System One API and the OpenAI Responses API. 12 start-target pairs × 2 reasoning configurations, 12-hop limit, run sequentially. Clock measures decision time only. Repo and raw results in the comments.*
