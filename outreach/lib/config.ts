import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG, type Config, type Sequence } from "./types.ts";

export const OUTREACH_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

// Load outreach/.env if present (API keys, provider credentials). Silent when missing.
try {
  process.loadEnvFile(join(OUTREACH_DIR, ".env"));
} catch {
  /* no .env, rely on the environment */
}
export const DATA_DIR = process.env.OUTREACH_DATA_DIR ?? join(OUTREACH_DIR, "data");
export const DB_PATH = process.env.OUTREACH_DB ?? join(DATA_DIR, "outreach.sqlite");
export const CONFIG_PATH = process.env.OUTREACH_CONFIG ?? join(OUTREACH_DIR, "config.json");

export function loadConfig(): Config {
  const path = existsSync(CONFIG_PATH) ? CONFIG_PATH : join(OUTREACH_DIR, "config.example.json");
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<Config>;
  const cfg: Config = { ...DEFAULT_CONFIG, ...raw, sender: { ...DEFAULT_CONFIG.sender, ...(raw.sender ?? {}) } };
  if (process.env.OUTREACH_PROVIDER) cfg.provider = process.env.OUTREACH_PROVIDER as Config["provider"];
  return cfg;
}

export function loadSequence(name: string): Sequence {
  const path = join(OUTREACH_DIR, "templates", `${name}.json`);
  if (!existsSync(path)) throw new Error(`No sequence template at ${path}`);
  const seq = JSON.parse(readFileSync(path, "utf8")) as Sequence;
  if (!Array.isArray(seq.steps) || seq.steps.length === 0) throw new Error(`Sequence ${name} has no steps`);
  seq.name = name;
  return seq;
}
