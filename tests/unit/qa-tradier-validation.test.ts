import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/env", () => ({
  env: {
    TRADIER_API_TOKEN: "qa-fake-token-no-network",
    TRADIER_BASE_URL: "https://qa.invalid",
  },
}));
vi.mock("@/server/providers/request", () => ({ providerRequest: vi.fn() }));
import { providerRequest } from "@/server/providers/request";
import { TradierOptionsProvider } from "@/server/providers/tradier";
const raw = {
  type: "option",
  symbol: "BTG280121C00005000",
  root_symbol: "BTG",
  underlying: "BTG",
  contract_size: 100,
  option_type: "call",
  strike: 5,
  expiration_date: "2028-01-21",
  bid: 1.8,
  ask: 1.84,
  last: 1.82,
  bid_date: Date.parse("2026-09-07T12:00:00Z"),
  ask_date: Date.parse("2026-09-07T12:00:00Z"),
};
async function quote(overrides: Record<string, unknown>) {
  vi.mocked(providerRequest).mockResolvedValueOnce({
    quotes: {
      quote: [
        { symbol: "BTG", type: "stock" },
        { ...raw, ...overrides },
      ],
    },
  });
  return (await new TradierOptionsProvider().getOptionQuote(raw.symbol))!;
}
beforeEach(() => vi.mocked(providerRequest).mockReset());
describe("QA: Tradier invalid provider data regression probes (no network)", () => {
  it.each([
    { contract_size: undefined },
    { root_symbol: undefined },
    { underlying: undefined },
    { root_symbol: "BTG1" },
    { type: "index" },
    { symbol: "BTG280218C00005000" },
  ])("does not invent missing standard-contract metadata %j", async (bad) => {
    expect(await quote(bad)).toBeNull();
  });
  it("requires actual stock/ETF classification even for an unfamiliar index root", async () => {
    const symbol = "NEWINDEX280121C00005000";
    vi.mocked(providerRequest).mockResolvedValueOnce({
      quotes: {
        quote: [
          { ...raw, symbol, underlying: "NEWINDEX", root_symbol: "NEWINDEX" },
          { symbol: "NEWINDEX", type: "index" },
        ],
      },
    });
    expect(
      await new TradierOptionsProvider().getOptionQuote(symbol),
    ).toBeNull();
  });
  it("matches a shuffled multi-symbol response by exact symbols", async () => {
    vi.mocked(providerRequest).mockResolvedValueOnce({
      quotes: { quote: [raw, { symbol: "BTG", type: "stock" }] },
    });
    expect(
      (await new TradierOptionsProvider().getOptionQuote(raw.symbol))
        ?.contractSymbol,
    ).toBe(raw.symbol);
  });
  it("keeps a valid quote and its original timestamp", async () => {
    const q = await quote({});
    expect(q.mark).toBeCloseTo(1.82);
    expect(q.asOf?.toISOString()).toBe("2026-09-07T12:00:00.000Z");
  });
  it.each([
    { bid: -2, ask: -1, last: -1 },
    { bid: "garbage", ask: "garbage", last: "garbage" },
    { bid: "Infinity", ask: "Infinity", last: "Infinity" },
  ])(
    "does not let invalid prices enter valuation/cache: %j",
    async (invalid) => {
      const q = await quote(invalid);
      expect(q.bid).toBeNull();
      expect(q.ask).toBeNull();
      expect(q.last).toBeNull();
      expect(q.mark).toBeNull();
    },
  );
  it("marks an invalid provider timestamp as unavailable instead of Invalid Date", async () => {
    const q = await quote({ bid_date: "garbage", ask_date: "garbage" });
    expect(q.asOf?.getTime()).toBe(0);
  });
  it("does not invent a valuation midpoint from a crossed market", async () => {
    const q = await quote({ bid: 2, ask: 1 });
    expect(q.mark).toBeNull();
  });
});
