import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
const sourcePolicy = vi.hoisted(() => ({ source: "alpaca-opra" }));

vi.mock("@/lib/env", () => ({
  env: {
    QUOTE_STALE_SECONDS: 120,
    MARKET_DATA_MODE: "live",
    ALPACA_FEED: "iex",
  },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    quoteCache: {
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async () => ({})),
    },
    order: { findUnique: vi.fn(async () => null) },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/server/providers/factory", () => ({
  quoteSourceFor: () => sourcePolicy.source,
  providers: {
    options: { getOptionQuote: vi.fn() },
    equities: { getQuote: vi.fn(async () => null) },
    fundamentals: { getSharesOutstanding: vi.fn(async () => null) },
  },
}));
import { prisma } from "@/lib/prisma";
import { providers } from "@/server/providers/factory";
import { parseAlpacaOption } from "@/server/providers/alpaca-options";
import { DemoOptionsProvider, decodeContract } from "@/server/providers/demo";
import { resolveTicket, executeOrder } from "@/server/services/order-service";
import { getLiveQuote } from "@/server/services/quote-service";
import { buildPositionProjection } from "@/server/services/projection-service";
import { projectOptionModelValue } from "@/server/domain/projection";
import { blackScholesPrice } from "@/server/domain/black-scholes";
import { createGuest, discardGuest, lockGuest } from "@/server/guest/store";
import {
  createPortfolio,
  guestOrder,
  guestTarget,
} from "@/server/guest/portfolio";
import { orderTicketSchema } from "@/server/api/schemas";

const D = Prisma.Decimal;
const symbol = "AAPL270115C00100000";
const ticket = (overrides: Record<string, unknown> = {}) => ({
  portfolioId: "fixture",
  symbol: "AAPL",
  assetClass: "OPTION" as const,
  side: "BUY" as const,
  orderType: "MARKET" as const,
  quantity: 1,
  optionContractSymbol: symbol,
  optionRight: "CALL" as const,
  optionStrike: 100,
  optionExpiration: new Date("2027-01-15T20:00:00Z"),
  ...overrides,
});
const contract = (overrides: Record<string, unknown> = {}) => ({
  ...decodeContract(symbol),
  contractSymbol: symbol,
  multiplier: 100,
  bid: 3,
  ask: 3.25,
  mark: 3.125,
  last: 3.1,
  asOf: new Date(),
  source: "alpaca-opra",
  impliedVolatility: 0.3,
  ...overrides,
});
const keys: string[] = [];
beforeEach(() => {
  sourcePolicy.source = "alpaca-opra";
  vi.mocked(prisma.order.findUnique).mockResolvedValue(null);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-11T16:00:00Z"));
  vi.mocked(providers.options.getOptionQuote).mockReset();
  vi.mocked(providers.options.getOptionQuote).mockImplementation(async () =>
    contract(),
  );
  vi.mocked(prisma.quoteCache.upsert).mockClear();
});
afterEach(() => {
  keys.splice(0).forEach(discardGuest);
  vi.useRealTimers();
});

describe("option execution integrity", () => {
  it("keeps ordinary Tradier prices visible but blocks unverified new fills", async () => {
    sourcePolicy.source = "tradier";
    vi.mocked(providers.options.getOptionQuote).mockResolvedValue(
      contract({ source: "tradier" }),
    );
    expect((await getLiveQuote(symbol, "OPTION", true))?.ask).toBe(3.25);
    await expect(resolveTicket(ticket())).rejects.toThrow(
      "Standard deliverable unverified",
    );
  });
  it("preserves a completed saved fill replay after its source becomes display-only", async () => {
    const input = ticket({ clientOrderId: crypto.randomUUID() });
    const fill = { id: "old-fill", positionId: null, price: new D(3.25) };
    vi.mocked(prisma.order.findUnique).mockResolvedValue({
      id: "old-order",
      portfolioId: "fixture",
      symbol: "AAPL",
      side: "BUY",
      assetClass: "OPTION",
      quantity: new D(1),
      orderType: "MARKET",
      optionContractSymbol: symbol,
      limitPrice: null,
      quoteSource: "tradier",
      fills: [fill],
    } as never);
    Object.assign(prisma, {
      portfolio: {
        findUniqueOrThrow: vi.fn(async () => ({ cashBalance: new D(675) })),
      },
      cashLedgerEntry: { findFirst: vi.fn(async () => null) },
    });
    const result = await executeOrder(input);
    expect(result).toMatchObject({
      replayed: true,
      quoteSource: "tradier",
      fillPrice: 3.25,
    });
    expect(providers.options.getOptionQuote).not.toHaveBeenCalled();
  });
  it.each([
    {
      contractSymbol: "AAPL270219C00100000",
      expiration: new Date("2027-02-19T21:00:00Z"),
    },
    { multiplier: undefined },
    { multiplier: 10 },
    { underlying: "MSFT" },
    { right: "PUT" },
    { strike: 101 },
  ])(
    "rejects mismatched or unverified metadata before pricing/caching %j",
    async (bad) => {
      vi.mocked(providers.options.getOptionQuote).mockResolvedValue(
        contract(bad),
      );
      await expect(resolveTicket(ticket())).rejects.toThrow();
      expect(prisma.quoteCache.upsert).not.toHaveBeenCalled();
    },
  );
  it("validates and uses one provider response, with no second-lookup substitution", async () => {
    vi.mocked(providers.options.getOptionQuote)
      .mockResolvedValueOnce(contract({ ask: 3.25 }))
      .mockResolvedValueOnce(
        contract({ contractSymbol: "AAPL270219C00100000", ask: 99 }),
      );
    expect((await resolveTicket(ticket())).decision.fillPrice).toBe(3.25);
    expect(providers.options.getOptionQuote).toHaveBeenCalledTimes(1);
    await expect(resolveTicket(ticket())).rejects.toThrow();
  });
  it("does not expire a winter contract before 16:00 Eastern", async () => {
    vi.setSystemTime(new Date("2027-01-15T20:30:00Z"));
    expect((await resolveTicket(ticket())).decision.fillable).toBe(true);
  });
  it.each(["freshness", "expiration"])(
    "rechecks %s after waiting for the portfolio lock, before any financial write",
    async (boundary) => {
      if (boundary === "expiration")
        vi.setSystemTime(new Date("2027-01-15T20:59:59Z"));
      const asOf = new Date(
        Date.now() - (boundary === "freshness" ? 119000 : 0),
      );
      vi.mocked(providers.options.getOptionQuote).mockResolvedValue(
        contract({ asOf }),
      );
      const write = vi.fn();
      const tx = {
        $queryRaw: async () => {
          vi.setSystemTime(new Date(Date.now() + 5000));
          return [];
        },
        portfolio: {
          findUnique: async () => ({ id: "fixture", cashBalance: new D(1000) }),
          update: write,
        },
        position: { findUnique: async () => null, create: write },
        order: { create: write },
        cashLedgerEntry: { create: write },
        optionPositionDetails: { upsert: write },
        fill: { create: write },
      };
      vi.mocked(prisma.$transaction).mockImplementation(async (action: any) =>
        action(tx),
      );
      await expect(executeOrder(ticket())).rejects.toThrow(
        boundary === "freshness" ? "stale" : "Expired contracts",
      );
      expect(write).not.toHaveBeenCalled();
    },
  );
});

describe("option execution: shared validation and guest ledger", () => {
  it.each([
    { source: "alpaca-opra-delayed" },
    { source: "alpaca-opra-indicative" },
    { asOf: new Date("2026-09-11T15:55:00Z") },
    { asOf: new Date("2026-09-11T16:00:06Z") },
    { multiplier: 10 },
  ])(
    "rejects unavailable, stale, future, or adjusted contract input %j",
    async (bad) => {
      vi.mocked(providers.options.getOptionQuote).mockResolvedValue(
        contract(bad),
      );
      await expect(resolveTicket(ticket())).rejects.toThrow();
    },
  );
  it("rejects a fractional option count at the API schema", () => {
    expect(orderTicketSchema.safeParse(ticket({ quantity: 1.5 })).success).toBe(
      false,
    );
  });
  it.each(["CALL", "PUT"] as const)(
    "keeps %s buy, weighted basis, partial/full sale and replay consistent",
    async (right) => {
      const { state } = createGuest();
      keys.push(state.key);
      const p = createPortfolio(state, {
        name: "Disposable options",
        startingCash: 10000,
      });
      const optionSymbol = symbol.replace(
        "C001",
        right === "CALL" ? "C001" : "P001",
      );
      let ask = 3.25,
        bid = 3;
      vi.mocked(providers.options.getOptionQuote).mockImplementation(async () =>
        contract({
          contractSymbol: optionSymbol,
          right,
          ask,
          bid,
          mark: (ask + bid) / 2,
        }),
      );
      const input = (overrides = {}) =>
        ticket({
          portfolioId: p.id,
          optionContractSymbol: optionSymbol,
          optionRight: right,
          clientOrderId: crypto.randomUUID(),
          ...overrides,
        });
      const a = input({ quantity: 2 });
      expect(
        ((await guestOrder(state, a, false)) as any).preview.estimatedNotional,
      ).toBe(650);
      expect(p.cashBalance.toNumber()).toBe(10000);
      await guestOrder(state, a, true);
      expect(p.cashBalance.toNumber()).toBe(9350);
      await guestTarget(state, p.positions[0].id, {
        targetMode: "PRICE",
        targetPrice: 120,
      });
      ask = 4;
      bid = 3.8;
      await guestOrder(state, input(), true);
      expect(p.positions[0].avgCost.toNumber()).toBe(3.5);
      bid = 5;
      ask = 5.1;
      const closeOne = input({ side: "SELL" });
      await guestOrder(state, closeOne, true);
      expect(p.positions[0].quantity.toNumber()).toBe(2);
      expect(p.positions[0].optionDetails?.contracts).toBe(2);
      expect(p.positions[0].optionDetails?.entryPremium.toNumber()).toBe(3.5);
      expect(p.positions[0].targetScenario).not.toBeNull();
      expect(p.orders.at(-1)!.fills[0].realizedPnL.toNumber()).toBe(150);
      expect(
        ((await guestOrder(state, closeOne, true)) as any).execution.replayed,
      ).toBe(true);
      await expect(
        guestOrder(state, input({ side: "SELL", quantity: 3 }), true),
      ).rejects.toThrow("Short selling");
      await guestOrder(state, input({ side: "SELL", quantity: 2 }), true);
      expect(p.positions).toEqual([]);
      expect(p.cashBalance.toNumber()).toBe(10450);
      expect(
        p.orders.reduce((n, o) => n + o.fills[0].realizedPnL.toNumber(), 0),
      ).toBe(450);
      expect(
        p.cashLedgerEntries.reduce((n, e) => n + e.amount.toNumber(), 0),
      ).toBe(10450);
      expect(
        p.orders.flatMap((o) => o.fills).every((f) => f.positionId === null),
      ).toBe(true);
    },
  );
  it("serializes competing option buys and duplicate submissions with the actual guest queue", async () => {
    const { state } = createGuest();
    keys.push(state.key);
    const p = createPortfolio(state, {
      name: "Concurrency fixture",
      startingCash: 400,
    });
    const a = ticket({ portfolioId: p.id, clientOrderId: crypto.randomUUID() });
    const b = ticket({ portfolioId: p.id, clientOrderId: crypto.randomUUID() });
    const result = await Promise.allSettled(
      [a, a, b].map((t) =>
        lockGuest(state.key, () => guestOrder(state, t, true)),
      ),
    );
    expect(result.map((r) => r.status)).toEqual([
      "fulfilled",
      "fulfilled",
      "rejected",
    ]);
    expect(p.orders).toHaveLength(1);
    expect(p.cashBalance.toNumber()).toBe(75);
  });
});
