import { afterEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("node:fs", () => ({ readFileSync: fixture.read }));
import {
  developmentMarketEnv,
  localMarketFields,
} from "@/server/config/development-market-env";

const inherited = {
  NODE_ENV: "development",
  MARKET_DATA_MODE: "live",
  EQUITY_PROVIDER: "schwab",
  ALPACA_API_KEY: "old-fixture-key",
  ALPACA_API_SECRET: "old-fixture-secret",
  DATABASE_URL: "postgresql://fixture@localhost/fixture",
  BETTER_AUTH_SECRET: "auth-fixture",
  SCHWAB_CLIENT_SECRET: "schwab-fixture",
  TRADIER_API_TOKEN: "tradier-fixture",
};
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  fixture.read.mockReset();
});

describe("authoritative local development market configuration", () => {
  it("overrides inherited blanks/current mode using one file pair without mutating the environment", () => {
    const original = {
      ...inherited,
      ALPACA_API_KEY: "",
      ALPACA_API_SECRET: "",
    };
    const result = developmentMarketEnv(
      original,
      () =>
        "MARKET_DATA_MODE=demo\nALPACA_API_KEY=new-key\nALPACA_API_SECRET=new-secret\n",
    );
    expect(result.MARKET_DATA_MODE).toBe("demo");
    expect([result.ALPACA_API_KEY, result.ALPACA_API_SECRET]).toEqual([
      "new-key",
      "new-secret",
    ]);
    expect(original.ALPACA_API_KEY).toBe("");
    expect(original.MARKET_DATA_MODE).toBe("live");
  });

  it("ignores file attempts to override database, auth, Schwab and unrelated provider credentials", () => {
    const result = developmentMarketEnv(
      inherited,
      () =>
        "MARKET_DATA_MODE=demo\nDATABASE_URL=untrusted\nBETTER_AUTH_SECRET=untrusted\nSCHWAB_CLIENT_SECRET=untrusted\nTRADIER_API_TOKEN=untrusted\n",
    );
    for (const key of [
      "DATABASE_URL",
      "BETTER_AUTH_SECRET",
      "SCHWAB_CLIENT_SECRET",
      "TRADIER_API_TOKEN",
    ])
      expect(result[key]).toBe(inherited[key as keyof typeof inherited]);
  });

  it("clears absent public settings and credential pairs instead of restoring inherited live choices", () => {
    const result = developmentMarketEnv(
      inherited,
      () => "MARKET_DATA_MODE=demo\n",
    );
    for (const field of localMarketFields.filter(
      (field) => field !== "MARKET_DATA_MODE",
    ))
      expect(result[field]).toBeUndefined();
    expect(result.ALPACA_API_KEY).toBeUndefined();
    expect(result.ALPACA_API_SECRET).toBeUndefined();
  });

  it.each([
    "ALPACA_API_KEY=\nALPACA_API_SECRET=\n",
    "ALPACA_API_KEY=\n",
    "ALPACA_API_SECRET='  '\n",
  ])("clears blank credentials atomically: %s", (pair) => {
    const result = developmentMarketEnv(
      inherited,
      () => "MARKET_DATA_MODE=demo\n" + pair,
    );
    expect(result.ALPACA_API_KEY).toBeUndefined();
    expect(result.ALPACA_API_SECRET).toBeUndefined();
  });

  it.each([
    "ALPACA_API_KEY=fixture\n",
    "ALPACA_API_SECRET=fixture\n",
    "ALPACA_API_KEY=fixture\nALPACA_API_SECRET=\n",
  ])("rejects a partial nonempty pair: %s", (pair) => {
    expect(() =>
      developmentMarketEnv(inherited, () => "MARKET_DATA_MODE=demo\n" + pair),
    ).toThrow("Incomplete local configuration fields");
  });

  it.each([
    "# absent mode\n",
    "MARKET_DATA_MODE live\n",
    'MARKET_DATA_MODE="live\n',
    "MARKET_DATA_MODE=demo\nMARKET_DATA_MODE=live\n",
  ])("fails closed on missing or malformed mode syntax: %s", (source) => {
    expect(() => developmentMarketEnv(inherited, () => source)).toThrow();
  });

  it("accepts documented quotes, comments and export syntax without interpolation", () => {
    const result = developmentMarketEnv(
      inherited,
      () =>
        '# local settings\nexport MARKET_DATA_MODE = "demo" # comment\nALPACA_FEED=iex\nALPACA_API_KEY="fixture#key"\nALPACA_API_SECRET=\'fixture$secret\'\n',
    );
    expect(result.MARKET_DATA_MODE).toBe("demo");
    expect(result.ALPACA_API_KEY).toBe("fixture#key");
    expect(result.ALPACA_API_SECRET).toBe("fixture$secret");
  });

  it("sanitizes unreadable-file errors and never falls back to inherited live mode", () => {
    expect(() =>
      developmentMarketEnv(inherited, () => {
        throw Error("private diagnostic");
      }),
    ).toThrow("Cannot read local development market-data configuration.");
  });

  it("preserves valid unrelated multiline values without treating embedded settings as assignments", () => {
    const result = developmentMarketEnv(
      inherited,
      () =>
        'MARKET_DATA_MODE=demo\nUNRELATED_CERT="first line\nMARKET_DATA_MODE=live\nALPACA_API_KEY=embedded-key\nsecond line"\nALPACA_FEED=iex\n',
    );
    expect(result.MARKET_DATA_MODE).toBe("demo");
    expect(result.ALPACA_FEED).toBe("iex");
    expect(result.ALPACA_API_KEY).toBeUndefined();
    expect(result.ALPACA_API_SECRET).toBeUndefined();
  });

  it.each(["production", "test", undefined])(
    "never reads a local file outside development (%s)",
    (nodeEnv) => {
      const read = vi.fn(() => {
        throw Error("must not read");
      });
      const input = { ...inherited, NODE_ENV: nodeEnv };
      expect(developmentMarketEnv(input, read)).toEqual(input);
      expect(read).not.toHaveBeenCalled();
    },
  );

  it("validates actual env module values with field-only errors, never raw rejected text", async () => {
    vi.stubEnv("NODE_ENV", "development");
    fixture.read.mockReturnValue("MARKET_DATA_MODE=private-fixture-marker\n");
    let message = "";
    try {
      await import("@/lib/env");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("MARKET_DATA_MODE");
    expect(message).not.toContain("private-fixture-marker");
    expect(fixture.read).toHaveBeenCalledWith(
      expect.stringMatching(/\/\.env$/),
      "utf8",
    );
  });
});
