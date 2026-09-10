import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  env: {
    MARKET_DATA_MODE: "demo",
    EQUITY_PROVIDER: "alpaca",
    OPTIONS_PROVIDER: "alpaca",
    ALPACA_FEED: "iex",
    ALPACA_API_KEY: "fixture-key",
    ALPACA_API_SECRET: "fixture-secret",
    ALPACA_DATA_BASE_URL: "https://data.alpaca.markets",
    QUOTE_STALE_SECONDS: 120,
  },
  request: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ env: fixture.env }));
vi.mock("@/server/providers/request", () => ({
  providerRequest: fixture.request,
}));
vi.mock("@/server/providers/alpaca-symbols", () => ({
  loadAlpacaSymbols: async () => [{ symbol: "SPY" }],
}));
vi.mock("@/server/providers/schwab-client", () => ({
  schwabStatus: () => ({ state: "not_configured" }),
}));
vi.mock("@/server/providers/schwab", () => ({}));
vi.mock("@/server/providers/tradier", () => ({}));

import { GET } from "@/app/api/market-data/check/route";

const now = "2026-09-09T18:00:00.000Z";
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  fixture.request.mockReset();
  fixture.env.ALPACA_FEED = "iex";
  fixture.env.ALPACA_API_KEY = "fixture-key";
  fixture.env.ALPACA_API_SECRET = "fixture-secret";
});
afterEach(() => vi.useRealTimers());

describe("Alpaca connection checks use the configured equity feed", () => {
  it.each(["iex", "sip"])(
    "requests and labels %s while preserving independent OPRA entitlement failure",
    async (feed) => {
      fixture.env.ALPACA_FEED = feed;
      fixture.request.mockImplementation(async (_provider, url) => {
        if (new URL(url).pathname === "/v2/stocks/quotes/latest")
          return { quotes: { SPY: { t: now } } };
        throw new Error("Alpaca: credentials/entitlement (403)");
      });
      const response = await GET(),
        body = await response.json();
      expect(body).toMatchObject({
        mode: "demo",
        equityFeedConfigured: feed,
      });
      expect(body.checks).toContainEqual(
        expect.objectContaining({
          name: `Alpaca ${feed.toUpperCase()} stock quotes`,
          status: "accessible_fresh",
          asOf: now,
        }),
      );
      expect(body.checks).toContainEqual({
        name: "Alpaca OPRA option quotes",
        status: "failed",
        detail: "Alpaca: credentials/entitlement (403)",
      });
      const urls = fixture.request.mock.calls.map((call) => new URL(call[1]));
      expect(
        urls.map((url) => [url.pathname, url.searchParams.get("feed")]),
      ).toEqual([
        ["/v2/stocks/quotes/latest", feed],
        ["/v1beta1/options/snapshots/SPY", "opra"],
      ]);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    },
  );

  it.each([
    ["2026-09-09T17:00:00.000Z", "accessible_stale"],
    [undefined, "authorized_no_quote"],
    ["invalid", "authorized_no_quote"],
  ])("keeps %s timestamp classified as %s", async (timestamp, status) => {
    fixture.request.mockResolvedValue({ quotes: { SPY: { t: timestamp } } });
    const body = await (await GET()).json();
    const stock = body.checks.find(
      (row: { name: string }) => row.name === "Alpaca IEX stock quotes",
    );
    expect(stock.status).toBe(status);
    if (status === "authorized_no_quote") expect(stock.asOf).toBeUndefined();
  });

  it("labels the configured feed without requesting data when credentials are missing", async () => {
    fixture.env.ALPACA_API_KEY = "";
    fixture.env.ALPACA_API_SECRET = "";
    const body = await (await GET()).json();
    expect(body.checks).toContainEqual(
      expect.objectContaining({
        name: "Alpaca IEX stock quotes",
        status: "not_configured",
      }),
    );
    expect(fixture.request).not.toHaveBeenCalled();
  });
});
