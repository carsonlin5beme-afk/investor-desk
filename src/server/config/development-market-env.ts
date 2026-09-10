// Node-server only: never import this module from client components or Edge middleware.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

export const localMarketFields = [
  "MARKET_DATA_MODE",
  "EQUITY_PROVIDER",
  "OPTIONS_PROVIDER",
  "ALPACA_FEED",
  "ALPACA_DATA_BASE_URL",
  "ALPACA_REFERENCE_BASE_URL",
  "ALPACA_WS_URL",
] as const;
const credentialFields = ["ALPACA_API_KEY", "ALPACA_API_SECRET"] as const;
const selected = new Set<string>([...localMarketFields, ...credentialFields]);

function parseLocalFile(text: string): Record<string, string | undefined> {
  // Selected fields require one-line assignments. Track unrelated quoted blocks
  // so their contents cannot masquerade as market settings or break valid files.
  const seen = new Set<string>();
  let unrelatedQuote: string | null = null;
  for (const [index, line] of text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .entries()) {
    if (unrelatedQuote) {
      if (line.includes(unrelatedQuote)) unrelatedQuote = null;
      continue;
    }
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const assignment =
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!assignment)
      throw new Error(
        `Invalid local configuration syntax at line ${index + 1}.`,
      );
    const [, key, value] = assignment;
    if (value.startsWith('"') || value.startsWith("'")) {
      const closing = value.indexOf(value[0], 1);
      if (closing < 0 && !selected.has(key)) {
        unrelatedQuote = value[0];
        continue;
      }
      if (closing < 0 || !/^\s*(?:#.*)?$/.test(value.slice(closing + 1)))
        throw new Error(
          `Invalid local configuration syntax at line ${index + 1}.`,
        );
    }
    if (selected.has(key) && seen.has(key))
      throw new Error(`Duplicate local configuration field: ${key}.`);
    seen.add(key);
  }
  if (unrelatedQuote) throw new Error("Invalid local configuration syntax.");
  try {
    return parseEnv(text);
  } catch {
    throw new Error("Invalid local configuration syntax.");
  }
}

/** .env is authoritative for these local development fields, on module reload. */
export function developmentMarketEnv(
  inherited: Record<string, string | undefined>,
  readLocalFile = () => readFileSync(resolve(process.cwd(), ".env"), "utf8"),
): Record<string, string | undefined> {
  if (inherited.NODE_ENV !== "development") return { ...inherited };
  let text: string;
  try {
    text = readLocalFile();
  } catch {
    throw new Error("Cannot read local development market-data configuration.");
  }
  const local = parseLocalFile(text);
  if (!Object.hasOwn(local, "MARKET_DATA_MODE"))
    throw new Error("Missing local configuration field: MARKET_DATA_MODE.");
  const result = { ...inherited };
  // Undefined intentionally selects schema defaults, never stale inherited values.
  for (const field of localMarketFields) result[field] = local[field];
  const key = local.ALPACA_API_KEY?.trim() ?? "";
  const secret = local.ALPACA_API_SECRET?.trim() ?? "";
  if (Boolean(key) !== Boolean(secret))
    throw new Error(
      "Incomplete local configuration fields: ALPACA_API_KEY, ALPACA_API_SECRET.",
    );
  // Both absent/blank explicitly clears the pair. Never combine file/shell partners.
  result.ALPACA_API_KEY = key || undefined;
  result.ALPACA_API_SECRET = secret || undefined;
  return result;
}
