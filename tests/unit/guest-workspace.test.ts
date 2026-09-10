import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/server/services/order-service", async () => {
  const { decideFill } = await import("@/server/domain/fill-engine");
  return {
    resolveTicket: vi.fn(async (ticket) => {
      const symbol = ticket.optionContractSymbol ?? ticket.symbol;
      const quote = {
        symbol,
        assetClass: ticket.assetClass,
        bid: ticket.assetClass === "OPTION" ? 1.81 : 319.95,
        ask: ticket.assetClass === "OPTION" ? 1.83 : 320.05,
        mark: ticket.assetClass === "OPTION" ? 1.82 : 320,
        last: null,
        source: "demo",
        asOf: new Date(),
      };
      return { symbol, quote, decision: decideFill(ticket, quote) };
    }),
  };
});
vi.mock("@/server/services/quote-service", () => ({
  getLiveQuote: vi.fn(async () => null),
  quoteMark: () => null,
}));
import {
  createGuest,
  discardGuest,
  getGuest,
  guestKey,
  lockGuest,
  GUEST_TTL_MS,
} from "@/server/guest/store";
import {
  adjustCash,
  createPortfolio,
  guestOrder,
  guestTarget,
  ownedPortfolio,
} from "@/server/guest/portfolio";
const keys: string[] = [];
const workspace = () => {
  const g = createGuest();
  keys.push(g.state.key);
  return g;
};
afterEach(() => {
  for (const key of keys.splice(0)) discardGuest(key);
  vi.restoreAllMocks();
});
const buy = (id: string, quantity = 228) => ({
  portfolioId: id,
  assetClass: "EQUITY",
  symbol: "TSLA",
  side: "BUY",
  quantity,
  orderType: "MARKET",
  clientOrderId: crypto.randomUUID(),
});
describe("temporary guest portfolios", () => {
  it("starts empty, uses an unguessable session, and never exposes another workspace", () => {
    const a = workspace(),
      b = workspace();
    expect(a.state.portfolios).toEqual([]);
    expect(guestKey(a.token)).toBe(a.state.key);
    expect(a.token).not.toBe(b.token);
    const p = createPortfolio(a.state, {
      name: "Personal",
      startingCash: 250000,
    });
    expect(() => ownedPortfolio(b.state, p.id)).toThrow("not found");
    expect(getGuest(a.state.key)?.portfolios[0].cashBalance.toNumber()).toBe(
      250000,
    );
  });
  it("expires temporary state after 24 hours idle", () => {
    const { state } = workspace();
    const now = Date.now();
    expect(state.expiresAt).toBeLessThanOrEqual(now + GUEST_TTL_MS);
    vi.spyOn(Date, "now").mockReturnValue(state.expiresAt + 1);
    expect(getGuest(state.key)).toBeNull();
  });
  it("buys stock, preserves targets and supports deposits/withdrawals without a saved profile", async () => {
    const { state } = workspace(),
      p = createPortfolio(state, { name: "Personal", startingCash: 250000 }),
      ticket = buy(p.id);
    const result = await guestOrder(state, ticket, true);
    expect("execution" in result && result.execution.portfolioCashBalance).toBe(
      177028.6,
    );
    expect(p.positions[0].quantity.toNumber()).toBe(228);
    await guestTarget(state, p.positions[0].id, {
      targetMode: "PRICE",
      targetPrice: 2000,
    });
    expect(p.positions[0].targetScenario?.targetPrice?.toNumber()).toBe(2000);
    adjustCash(state, p.id, { type: "DEPOSIT", amount: 100 });
    adjustCash(state, p.id, { type: "WITHDRAWAL", amount: 50 });
    expect(p.cashBalance.toNumber()).toBe(177078.6);
    expect(
      p.cashLedgerEntries.reduce((s, e) => s + e.amount.toNumber(), 0),
    ).toBe(p.cashBalance.toNumber());
  });
  it("retries the same execution only once, rejects changed inputs with that key", async () => {
    const { state } = workspace(),
      p = createPortfolio(state, { name: "Test", startingCash: 1000 }),
      ticket = buy(p.id, 1);
    const a = await guestOrder(state, ticket, true),
      b = await guestOrder(state, ticket, true);
    expect(a).toEqual(b);
    expect(p.orders).toHaveLength(1);
    await expect(
      guestOrder(state, { ...ticket, quantity: 2 }, true),
    ).rejects.toThrow("submission ID");
  });
  it("serializes competing buys and never overspends", async () => {
    const { state } = workspace(),
      p = createPortfolio(state, { name: "Test", startingCash: 1000 });
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () =>
        lockGuest(state.key, () => guestOrder(state, buy(p.id, 1), true)),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(p.cashBalance.toNumber()).toBe(39.85);
  });
  it("stores option metadata and contract multiplier; full close removes its target and fill links", async () => {
    const { state } = workspace(),
      p = createPortfolio(state, { name: "Options", startingCash: 250000 });
    const t = {
      ...buy(p.id, 600),
      assetClass: "OPTION",
      symbol: "BTG",
      optionContractSymbol: "BTG301220C00005000",
      optionRight: "CALL",
      optionStrike: 5,
      optionExpiration: "2030-12-20T20:00:00Z",
    };
    await guestOrder(state, t, true);
    expect(p.cashBalance.toNumber()).toBe(140200);
    const h = p.positions[0];
    expect(h.optionDetails?.strike.toNumber()).toBe(5);
    expect(h.optionDetails?.multiplier).toBe(100);
    await guestTarget(state, h.id, {
      targetMode: "MARKET_CAP",
      targetMarketCap: 50000000000,
      useManualShares: true,
      sharesOutstandingManual: 1350000000,
    });
    await guestOrder(
      state,
      { ...t, side: "SELL", clientOrderId: crypto.randomUUID() },
      true,
    );
    expect(p.positions).toEqual([]);
    expect(
      p.orders.flatMap((o) => o.fills).every((f) => f.positionId === null),
    ).toBe(true);
  });
  it("releases a queue when an action fails", async () => {
    const { state } = workspace();
    const a = lockGuest(state.key, async () => {
      throw new Error("test failure");
    }).catch(() => "failed");
    const b = lockGuest(state.key, async () => "continued");
    expect(await a).toBe("failed");
    expect(await b).toBe("continued");
  });
});
