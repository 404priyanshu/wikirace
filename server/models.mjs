import OpenAI from "openai";
import { config } from "./config.mjs";

// maxRetries: 0 so this module owns retrying for both racers. The SDK's own
// retries would otherwise give GPT free resilience that Jev does not get, and
// would fold retry latency into the decision time we report.
const openai = config.openaiApiKey
  ? new OpenAI({ apiKey: config.openaiApiKey, maxRetries: 0 })
  : null;

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 600;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isTransient(error) {
  const status = error?.status ?? error?.response?.status ?? error?.httpStatus;
  if ([408, 429, 500, 502, 503, 504].includes(status)) return true;
  return /\b(429|500|502|503|504)\b|model_unavailable|ECONNRESET|ETIMEDOUT|fetch failed/i.test(
    error?.message || "",
  );
}

/**
 * Both racers sit behind hosted services that blip. A transient failure is
 * infrastructure, not judgment, so only the attempt that actually produced an
 * answer is timed; the retries are counted instead.
 */
async function withRetry(label, run) {
  let attempts = 0;
  let lastError;
  while (attempts < MAX_ATTEMPTS) {
    attempts += 1;
    const startedAt = performance.now();
    try {
      const value = await run();
      return {
        value,
        elapsedMs: performance.now() - startedAt,
        retries: attempts - 1,
      };
    } catch (error) {
      lastError = error;
      if (attempts >= MAX_ATTEMPTS || !isTransient(error)) break;
      await sleep(BASE_BACKOFF_MS * 2 ** (attempts - 1) + Math.random() * 200);
    }
  }
  throw new Error(
    `${label} failed after ${attempts} attempt(s): ${lastError?.message || lastError}`,
  );
}

function criteria(current, target) {
  return [
    `You are racing through Wikipedia from "${current}" to "${target}".`,
    "Choose exactly one candidate article that is most likely to lead to the target in the fewest future Wikipedia-link clicks.",
    "Prefer strong semantic bridges, broad hub articles, disciplines, technologies, people, places, or concepts tightly associated with the target.",
    "Do not choose based on list position. Return only the candidate id.",
  ].join(" ");
}

function compactChoices(choices) {
  return Object.fromEntries(
    choices.map((title, index) => [String(index + 1), title]),
  );
}

export async function chooseWithGpt({ current, target, choices }) {
  if (!openai) throw new Error("OPENAI_API_KEY is not configured");
  const candidates = compactChoices(choices);
  const {
    value: response,
    elapsedMs,
    retries,
  } = await withRetry("GPT", () =>
    openai.responses.create({
      model: "gpt-5.6-sol",
      reasoning: { effort: config.gptReasoningEffort },
      store: false,
      input: [
        {
          role: "user",
          content: `${criteria(current, target)}\n\nCandidates:\n${JSON.stringify(candidates)}`,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "wikipedia_link_choice",
          strict: true,
          schema: {
            type: "object",
            properties: {
              id: { type: "string", enum: Object.keys(candidates) },
            },
            required: ["id"],
            additionalProperties: false,
          },
        },
      },
    }),
  );
  const parsed = JSON.parse(response.output_text);
  const choice = candidates[parsed.id];
  if (!choice) throw new Error("GPT returned an invalid Wikipedia link");
  return { choice, elapsedMs, retries };
}

export async function chooseWithJev({ current, target, choices }) {
  if (!config.typesafeApiKey)
    throw new Error("TYPESAFE_API_KEY is not configured");
  const candidates = compactChoices(choices);
  const {
    value: payload,
    elapsedMs,
    retries,
  } = await withRetry("Jev", async () => {
    const response = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.typesafeApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "jev-latest",
        state: {
          current_article: current,
          target_article: target,
          candidate_articles: candidates,
        },
        questions: {
          next_link: {
            type: "choice",
            instructions: criteria(current, target),
            criteria: Object.fromEntries(
              Object.entries(candidates).map(([id, title]) => [
                id,
                `Wikipedia article: ${title}`,
              ]),
            ),
          },
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw Object.assign(
        new Error(
          `TypeSafe returned HTTP ${response.status}: ${detail.slice(0, 160)}`,
        ),
        { status: response.status },
      );
    }
    return response.json();
  });

  const id = payload.answers?.next_link?.choice;
  const choice = candidates[String(id)] || (choices.includes(id) ? id : null);
  if (!choice) throw new Error("Jev returned an invalid Wikipedia link");
  return { choice, elapsedMs, retries };
}
