import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketQuote } from "@/server/domain/types";
const { get, settings } = vi.hoisted(() => ({
  get: vi.fn(),
  settings: {
    MARKET_DATA_MODE: "live",
    EQUITY_PROVIDER: "alpaca",
    ALPACA_FEED: "iex",
    ALPACA_API_KEY: "synthetic",
    ALPACA_API_SECRET: "synthetic",
    ALPACA_REFERENCE_BASE_URL: "http://127.0.0.1:53416",
  },
}));
vi.mock("@/lib/env", () => ({ env: settings }));
vi.mock("@/server/providers/alpaca-client", () => ({ alpacaGet: get }));
let service: typeof import("@/server/services/closed-session-simulation");
let rows: { date: string; open: string; close: string }[];
let clock: Record<string, unknown>;
let quote: MarketQuote;
function setup(
  now = "2026-09-10T04:30:00Z",
  last = "2026-09-09",
  next = "2026-09-10",
  nextOpen = "2026-09-10T13:30:00Z",
  nextClose = "2026-09-10T20:00:00Z",
) {
  vi.setSystemTime(new Date(now));
  rows = [
    { date: last, open: "09:30", close: "16:00" },
    { date: next, open: "09:30", close: "16:00" },
  ];
  clock = {
    timestamp: now,
    is_open: false,
    next_open: nextOpen,
    next_close: nextClose,
  };
  quote = {
    symbol: "PL",
    assetClass: "EQUITY",
    source: "alpaca-iex",
    bid: 32,
    ask: 32.05,
    mark: 32.025,
    last: null,
    asOf: new Date(`${last}T20:00:00Z`),
  };
}
beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  get.mockReset();
  setup();
  get.mockImplementation(async (path: string) =>
    path === "/v2/clock" ? clock : rows,
  );
  service = await import("@/server/services/closed-session-simulation");
});
afterEach(() => vi.useRealTimers());

describe("verified closed-session historical-price simulation", () => {
  it.each([
    [
      "midnight ET",
      "2026-09-10T04:30:00Z",
      "2026-09-09",
      "2026-09-10",
      "2026-09-10T13:30:00Z",
      "2026-09-10T20:00:00Z",
    ],
    [
      "weekday after close",
      "2026-09-09T22:00:00Z",
      "2026-09-09",
      "2026-09-10",
      "2026-09-10T13:30:00Z",
      "2026-09-10T20:00:00Z",
    ],
    [
      "weekend",
      "2026-09-12T16:00:00Z",
      "2026-09-11",
      "2026-09-14",
      "2026-09-14T13:30:00Z",
      "2026-09-14T20:00:00Z",
    ],
    [
      "holiday",
      "2026-09-07T16:00:00Z",
      "2026-09-04",
      "2026-09-08",
      "2026-09-08T13:30:00Z",
      "2026-09-08T20:00:00Z",
    ],
    [
      "before open",
      "2026-09-10T12:00:00Z",
      "2026-09-09",
      "2026-09-10",
      "2026-09-10T13:30:00Z",
      "2026-09-10T20:00:00Z",
    ],
    [
      "winter",
      "2027-01-12T05:30:00Z",
      "2027-01-11",
      "2027-01-12",
      "2027-01-12T14:30:00Z",
      "2027-01-12T21:00:00Z",
    ],
    [
      "DST weekend",
      "2026-11-01T17:00:00Z",
      "2026-10-30",
      "2026-11-02",
      "2026-11-02T14:30:00Z",
      "2026-11-02T21:00:00Z",
    ],
  ])(
    "accepts the actual last-session quote during %s",
    async (_, now, last, next, open, close) => {
      setup(now, last, next, open, close);
      const result = await service.closedSessionEligibility(quote);
      expect(result.basis).toMatchObject({
        kind: "CLOSED_SESSION_LIMIT",
        quoteSource: "alpaca-iex",
        quoteAsOf: quote.asOf.toISOString(),
        sessionDate: last,
        nextOpen: open.replace("Z", ".000Z"),
      });
      expect(get.mock.calls.map(([path]) => path)).toEqual([
        "/v2/clock",
        "/v2/calendar",
      ]);
      expect(
        get.mock.calls.every((call) => call[2] === true && call[3] === 0),
      ).toBe(true);
    },
  );

  it("uses actual early-close calendar boundaries", async () => {
    setup(
      "2026-11-27T18:30:00Z",
      "2026-11-27",
      "2026-11-30",
      "2026-11-30T14:30:00Z",
      "2026-11-30T21:00:00Z",
    );
    rows[0].close = "13:00";
    quote.asOf = new Date("2026-11-27T17:59:00Z");
    expect(
      (await service.closedSessionEligibility(quote)).basis?.sessionDate,
    ).toBe("2026-11-27");
  });

  it("accepts the entire latest completed session, not only its closing minutes", async () => {
    quote.asOf = new Date("2026-09-09T13:30:00Z");
    expect(
      (await service.closedSessionEligibility(quote)).basis,
    ).not.toBeNull();
    quote.asOf = new Date("2026-09-09T13:29:59Z");
    expect((await service.closedSessionEligibility(quote)).basis).toBeNull();
  });

  it.each([
    { bid: null },
    { ask: null },
    { ask: 0 },
    { bid: -1 },
    { ask: NaN },
    { bid: Infinity },
    { bid: 40 },
    { asOf: new Date("invalid") },
    { asOf: new Date("2026-09-10T04:30:06Z") },
    { asOf: new Date("2026-09-08T20:00:00Z") },
    { source: "alpaca-opra" },
    { source: "alpaca-iex-delayed" },
    { assetClass: "OPTION" },
  ])("blocks invalid or ineligible quote %j", async (changes) => {
    Object.assign(quote, changes);
    expect((await service.closedSessionEligibility(quote)).basis).toBeNull();
  });

  it.each([
    { is_open: true },
    { is_open: "false" },
    { timestamp: "2026-09-10T04:29:00Z" },
    { next_open: "2026-09-10T04:00:00Z" },
    { next_open: "2026-09-10T09:30:00" },
    { next_close: "2026-09-10T21:00:00Z" },
  ])("blocks unknown, open or contradictory clock %j", async (changes) => {
    Object.assign(clock, changes);
    expect((await service.closedSessionEligibility(quote)).basis).toBeNull();
  });

  it("does not infer a holiday or closure from invalid calendar data", async () => {
    rows[0].date = "2026-02-30";
    expect((await service.closedSessionEligibility(quote)).basis).toBeNull();
    rows = [];
    expect((await service.closedSessionEligibility(quote)).basis).toBeNull();
  });

  it("returns a safe retry message on metadata failure without stale-on-error eligibility", async () => {
    get.mockRejectedValue(new Error("provider private detail"));
    const result = await service.closedSessionEligibility(quote);
    expect(result.basis).toBeNull();
    expect(result.reason).toContain("schedule is unavailable");
    expect(result.reason).not.toContain("private detail");
  });

  it("deduplicates reads, uses a stricter execution clock and never caches across open", async () => {
    await Promise.all([
      service.closedSessionEligibility(quote),
      service.closedSessionEligibility(quote),
    ]);
    expect(
      get.mock.calls.filter(([path]) => path === "/v2/clock"),
    ).toHaveLength(1);
    vi.setSystemTime(Date.now() + 2500);
    clock.timestamp = new Date().toISOString();
    await service.closedSessionEligibility(quote, true);
    expect(
      get.mock.calls.filter(([path]) => path === "/v2/clock"),
    ).toHaveLength(2);
    expect(
      get.mock.calls.filter(([path]) => path === "/v2/calendar"),
    ).toHaveLength(1);
    vi.setSystemTime(new Date("2026-09-10T13:29:59Z"));
    clock.timestamp = new Date().toISOString();
    const beforeOpen = await service.closedSessionEligibility(quote);
    expect(beforeOpen.basis?.validUntil).toBe("2026-09-10T13:30:00.000Z");
    vi.setSystemTime(new Date("2026-09-10T13:30:00Z"));
    expect(() => service.assertClosedSessionCurrent(beforeOpen.basis)).toThrow(
      "expired",
    );
    clock.timestamp = new Date().toISOString();
    clock.is_open = true;
    expect((await service.closedSessionEligibility(quote)).basis).toBeNull();
    expect(
      get.mock.calls.filter(([path]) => path === "/v2/clock"),
    ).toHaveLength(4);
  });
});
