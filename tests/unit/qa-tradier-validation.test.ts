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
  symbol: "BTG280121C00005000",
  root_symbol: "BTG",
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
    quotes: { quote: { ...raw, ...overrides } },
  });
  return (await new TradierOptionsProvider().getOptionQuote(raw.symbol))!;
}
beforeEach(() => vi.mocked(providerRequest).mockReset());
describe("QA: Tradier invalid provider data regression probes (no network)", () => {
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
