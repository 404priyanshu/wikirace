import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config();

function readTypesafeFallback() {
  const fallbackPath = path.join(os.homedir(), ".config", "jev-browser", ".env");
  if (!fs.existsSync(fallbackPath)) return "";
  const parsed = dotenv.parse(fs.readFileSync(fallbackPath));
  return parsed.TYPESAFE_API_KEY || parsed.typesafe_api_key || "";
}

export const config = {
  port: Number(process.env.PORT || 4173),
  // Hosted platforms route to the container, so only bind loopback in local dev.
  host: process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1"),
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  typesafeApiKey:
    process.env.TYPESAFE_API_KEY ||
    process.env.typesafe_api_key ||
    readTypesafeFallback(),
  // Public-demo guardrails: races run on the host's API keys, so cap the spend.
  maxRacesPerIpPerHour: Number(process.env.MAX_RACES_PER_IP_PER_HOUR || 3),
  maxRacesPerDay: Number(process.env.MAX_RACES_PER_DAY || 100),
  maxConcurrentRaces: Number(process.env.MAX_CONCURRENT_RACES || 2),
};

export function publicKeyStatus() {
  return {
    openai: Boolean(config.openaiApiKey),
    typesafe: Boolean(config.typesafeApiKey),
  };
}
