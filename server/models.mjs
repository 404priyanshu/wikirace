import OpenAI from "openai";
import { config } from "./config.mjs";

const openai = config.openaiApiKey
  ? new OpenAI({ apiKey: config.openaiApiKey })
  : null;

function criteria(current, target) {
  return [
    `You are racing through Wikipedia from "${current}" to "${target}".`,
    "Choose exactly one candidate article that is most likely to lead to the target in the fewest future Wikipedia-link clicks.",
    "Prefer strong semantic bridges, broad hub articles, disciplines, technologies, people, places, or concepts tightly associated with the target.",
    "Do not choose based on list position. Return only the candidate id.",
  ].join(" ");
}

function compactChoices(choices) {
  return Object.fromEntries(choices.map((title, index) => [String(index + 1), title]));
}

export async function chooseWithGpt({ current, target, choices }) {
  if (!openai) throw new Error("OPENAI_API_KEY is not configured");
  const candidates = compactChoices(choices);
  const startedAt = performance.now();
  const response = await openai.responses.create({
    model: "gpt-5.6-sol",
    reasoning: { effort: "none" },
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
          properties: { id: { type: "string", enum: Object.keys(candidates) } },
          required: ["id"],
          additionalProperties: false,
        },
      },
    },
  });
  const parsed = JSON.parse(response.output_text);
  const choice = candidates[parsed.id];
  if (!choice) throw new Error("GPT returned an invalid Wikipedia link");
  return { choice, elapsedMs: performance.now() - startedAt };
}

export async function chooseWithJev({ current, target, choices }) {
  if (!config.typesafeApiKey) throw new Error("TYPESAFE_API_KEY is not configured");
  const candidates = compactChoices(choices);
  const startedAt = performance.now();
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
    throw new Error(`TypeSafe returned HTTP ${response.status}: ${detail.slice(0, 160)}`);
  }
  const payload = await response.json();
  const id = payload.answers?.next_link?.choice;
  const choice = candidates[String(id)] || (choices.includes(id) ? id : null);
  if (!choice) throw new Error("Jev returned an invalid Wikipedia link");
  return { choice, elapsedMs: performance.now() - startedAt };
}
