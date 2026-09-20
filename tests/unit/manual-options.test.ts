import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
vi.mock("@/lib/env", () => ({
  env: {
    QUOTE_STALE_SECONDS: 120,
    MARKET_DATA_MODE: "live",
    OPTIONS_POLL_SECONDS: 15,
  },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    quoteCache: { findUnique: vi.fn(async () => null), upsert: vi.fn() },
    order: { findUnique: vi.fn(async () => null) },
    position: { findMany: vi.fn(async () => []) },
    guestImport: { findUnique: vi.fn(async () => null) },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/server/providers/factory", () => ({
  quoteSourceFor: vi.fn(() => "unavailable"),
  providers: {
    options: {
      getOptionQuote: vi.fn(async () => {
        throw new Error("No options feed");
      }),
    },
    equities: {
      getQuote: vi.fn(async () => null),
      subscribe: vi.fn(),
      getQuotes: vi.fn(async () => []),
    },
    fundamentals: { getSharesOutstanding: vi.fn(async () => null) },
  },
}));
import { prisma } from "@/lib/prisma";
import { providers, quoteSourceFor } from "@/server/providers/factory";
import {
  manualOptionSymbol,
  parseManualOptionSymbol,
} from "@/lib/manual-options";
import { orderTicketSchema } from "@/server/api/schemas";
import {
  resolveTicket,
  executeOrder,
  assertExecutionCurrent,
} from "@/server/services/order-service";
import { getLiveQuote } from "@/server/services/quote-service";
import { buildPositionProjection } from "@/server/services/projection-service";
import {
  ensureQuoteJobsForPortfolio,
  stopQuoteJobsForPortfolio,
} from "@/server/jobs/quote-jobs";
import { createGuest, discardGuest, lockGuest } from "@/server/guest/store";
import {
  createPortfolio,
  guestOrder,
  guestTarget,
} from "@/server/guest/portfolio";
import { importGuest } from "@/server/guest/import";
const D = Prisma.Decimal;
const keys: string[] = [];
function input(extra: Record<string, unknown> = {}) {
  return {
    portfolioId: "fixture",
    symbol: "BTG",
    assetClass: "OPTION",
    side: "BUY",
    orderType: "MARKET",
    quantity: 2,
    optionPricing: "MANUAL",
    manualPremium: 1.83,
    optionRight: "CALL",
    optionStrike: 5,
    optionExpiration: "2027-01-15",
    ...extra,
  };
}
function fixture(cash = 10000) {
  const { state } = createGuest();
  keys.push(state.key);
  const p = createPortfolio(state, {
    name: "Manual fixture",
    startingCash: cash,
  });
  const ticket = (extra = {}) =>
    input({ portfolioId: p.id, clientOrderId: crypto.randomUUID(), ...extra });
  return { state, p, ticket };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-19T16:00:00Z"));
  vi.clearAllMocks();
  vi.mocked(prisma.order.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.guestImport.findUnique).mockResolvedValue(null);
});
afterEach(() => {
  keys.splice(0).forEach(discardGuest);
  stopQuoteJobsForPortfolio("jobs-fixture");
  vi.useRealTimers();
});

describe("manual option request boundaries", () => {
  it("generates a stable identity from actual terms, independent of premium", () => {
    const parsed = orderTicketSchema.parse(input());
    expect(parsed.optionContractSymbol).toBe(
      "MANUAL:V1:BTG:2027-01-15:C:5000:100",
    );
    expect(
      orderTicketSchema.parse(input({ manualPremium: 2 })).optionContractSymbol,
    ).toBe(parsed.optionContractSymbol);
    expect(parseManualOptionSymbol(parsed.optionContractSymbol!)).toMatchObject(
      {
        underlying: "BTG",
        strike: 5,
        right: "CALL",
        expiration: new Date("2027-01-15T00:00:00Z"),
      },
    );
  });
  it.each([
    { optionExpiration: "2027-02-30" },
    { optionExpiration: "2027-02-30T16:00:00Z" },
    { optionExpiration: "not a date" },
    { optionStrike: 5.0001 },
    { quantity: 1.5 },
    { quantity: 0 },
    { manualPremium: 0 },
    { manualPremium: -1 },
    { manualPremium: 1.0000001 },
    { manualPremium: Infinity },
    { manualPremium: 1000001 },
    { manualPremium: 1000000, quantity: 10001 },
    { assetClass: "EQUITY" },
    { orderType: "LIMIT", limitPrice: 1.83 },
    { limitPrice: 1.83 },
    { optionContractSymbol: "BTG270115C00005000" },
    { optionContractSymbol: "MANUAL:V1:BTG:2027-01-15:P:5000:100" },
    { optionContractSymbol: "MANUAL:V2:BTG:2027-01-15:C:5000:100" },
    { optionContractSymbol: "MANUAL:V1:BTG:2027-01-15:C:5000:10" },
  ])("rejects invalid/mismatched manual input %j", (extra) => {
    expect(orderTicketSchema.safeParse(input(extra)).success).toBe(false);
  });
  it("rejects manual identities and premiums in provider mode", async () => {
    const parsed = orderTicketSchema.parse(input());
    const provider = {
      ...parsed,
      optionPricing: "PROVIDER" as const,
      manualPremium: undefined,
    };
    expect(orderTicketSchema.safeParse(provider).success).toBe(false);
    await expect(resolveTicket(provider)).rejects.toThrow(
      "require manual entry",
    );
    expect(providers.options.getOptionQuote).not.toHaveBeenCalled();
  });
  it.each(["2026-09-18", "2027-01-16", "2026-12-25"])(
    "rejects expired/nontrading date %s without a quote",
    async (date) => {
      await expect(
        resolveTicket(
          orderTicketSchema.parse(input({ optionExpiration: date })),
        ),
      ).rejects.toThrow();
      expect(providers.options.getOptionQuote).not.toHaveBeenCalled();
    },
  );
  it("enforces the actual expiration session cutoff", async () => {
    const t = orderTicketSchema.parse(input());
    vi.setSystemTime(new Date("2027-01-15T20:59:59Z"));
    expect((await resolveTicket(t)).decision.fillPrice).toBe(1.83);
    vi.setSystemTime(new Date("2027-01-15T21:00:00Z"));
    expect(() => assertExecutionCurrent(t, null, null)).toThrow(
      "Expired contracts",
    );
  });
});

describe("manual option accounting with unavailable option feeds", () => {
  it.each(["CALL", "PUT"])(
    "preserves %s basis, cash, partial/full sales, replay and expiry",
    async (right) => {
      const { state, p, ticket } = fixture();
      const first = ticket({ optionRight: right });
      const preview = (await guestOrder(state, first, false)) as any;
      expect(preview.preview).toMatchObject({
        estimatedNotional: 366,
        estimatedFillPrice: 1.83,
        cashBefore: 10000,
        cashAfter: 9634,
        quote: null,
      });
      expect(p.orders).toHaveLength(0);
      const buy = (await guestOrder(state, first, true)) as any;
      expect(buy.execution).toMatchObject({
        notional: 366,
        quoteSource: "manual",
        quoteAsOf: null,
        simulationBasis: "MANUAL",
        replayed: false,
      });
      await guestTarget(state, p.positions[0].id, {
        targetMode: "PRICE",
        targetPrice: 10,
      });
      await guestOrder(
        state,
        ticket({ optionRight: right, quantity: 1, manualPremium: 2.34 }),
        true,
      );
      expect(p.positions[0].avgCost.toNumber()).toBe(2);
      expect(p.positions[0].quantity.toNumber()).toBe(3);
      expect(p.cashBalance.toNumber()).toBe(9400);
      const projection = await buildPositionProjection(p.positions[0]);
      expect(projection).toMatchObject({
        currentMarketValue: 600,
        currentPrice: null,
        costBasis: 600,
        unrealizedPnL: 0,
        quoteSource: "manual",
        quoteAsOf: null,
        priceEstimated: true,
        valuationBasis: "COST_BASIS",
        ivEstimated: true,
        impliedVolatility: 0.6,
      });
      expect(projection.optionModelProjectedValue).not.toBeNull();
      const sell = ticket({
        optionRight: right,
        quantity: 1,
        side: "SELL",
        manualPremium: 3,
      });
      await guestOrder(state, sell, true);
      expect(p.positions[0].avgCost.toNumber()).toBe(2);
      expect(p.positions[0].optionDetails?.entryPremium.toNumber()).toBe(2);
      expect(p.positions[0].targetScenario).not.toBeNull();
      expect(p.orders.at(-1)!.fills[0].realizedPnL.toNumber()).toBe(100);
      expect(p.cashBalance.toNumber()).toBe(9700);
      const replay = (await guestOrder(state, sell, true)) as any;
      expect(replay.execution).toMatchObject({
        replayed: true,
        simulationBasis: "MANUAL",
        quoteAsOf: null,
      });
      await expect(
        guestOrder(state, { ...sell, manualPremium: 3.01 }, true),
      ).rejects.toThrow("different order");
      await expect(
        guestOrder(
          state,
          ticket({
            optionRight: right,
            side: "SELL",
            quantity: 3,
            manualPremium: 3,
          }),
          true,
        ),
      ).rejects.toThrow("Short selling");
      await guestOrder(
        state,
        ticket({
          optionRight: right,
          side: "SELL",
          quantity: 2,
          manualPremium: 1,
        }),
        true,
      );
      expect(p.positions).toEqual([]);
      expect(p.cashBalance.toNumber()).toBe(9900);
      expect(
        p.cashLedgerEntries
          .reduce((sum, e) => sum.plus(e.amount), new D(0))
          .toNumber(),
      ).toBe(9900);
      expect(
        p.orders
          .flatMap((o) => o.fills)
          .reduce((sum, f) => sum + f.realizedPnL.toNumber(), 0),
      ).toBe(-100);
      vi.setSystemTime(new Date("2027-01-16T12:00:00Z"));
      expect(
        ((await guestOrder(state, first, true)) as any).execution.replayed,
      ).toBe(true);
      expect(providers.options.getOptionQuote).not.toHaveBeenCalled();
    },
  );
  it("keeps a provider holding separate even when its contract terms match", async () => {
    const { state, p, ticket } = fixture();
    await guestOrder(state, ticket(), true);
    const manual = p.positions[0];
    p.positions.push({
      ...manual,
      id: "provider-position",
      symbol: "BTG270115C00005000",
      optionDetails: {
        ...manual.optionDetails!,
        positionId: "provider-position",
        optionSymbol: "BTG270115C00005000",
      },
    });
    await guestOrder(state, ticket({ side: "SELL", manualPremium: 2 }), true);
    expect(p.positions.map((p) => p.symbol)).toEqual(["BTG270115C00005000"]);
  });
  it("serializes duplicate and competing buys without duplicate fills or negative cash", async () => {
    const { state, p, ticket } = fixture(400);
    const a = ticket(),
      b = ticket();
    const results = await Promise.allSettled(
      [a, a, b].map((t) =>
        lockGuest(state.key, () => guestOrder(state, t, true)),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([
      "fulfilled",
      "fulfilled",
      "rejected",
    ]);
    expect(p.orders).toHaveLength(1);
    expect(p.cashBalance.toNumber()).toBe(34);
  });
  it("never authorizes one guest workspace to trade another's portfolio", async () => {
    const a = fixture(),
      b = fixture();
    await expect(guestOrder(b.state, a.ticket(), true)).rejects.toThrow(
      "Portfolio not found",
    );
    expect(a.p.cashBalance.toNumber()).toBe(10000);
  });
  it("keeps six-decimal entry price and one cent rounding consistent", async () => {
    const { state, p, ticket } = fixture();
    await guestOrder(
      state,
      ticket({ quantity: 3, manualPremium: 0.123456 }),
      true,
    );
    expect(p.orders[0].fills[0].price.toNumber()).toBe(0.123456);
    expect(p.cashBalance.toNumber()).toBe(9962.96);
    expect(p.positions[0].avgCost.toNumber()).toBe(0.123456);
  });
});

describe("manual provenance across refresh, saved execution and import", () => {
  it.each([
    "MANUAL:V1:BTG:2027-01-15:C:5000:100",
    "manual:malformed",
    " MANUAL:V99:bad",
  ])("skips all provider/cache/source resolution for %s", async (symbol) => {
    expect(await getLiveQuote(symbol, "OPTION", true)).toBeNull();
    expect(await getLiveQuote(symbol, "OPTION")).toBeNull();
    expect(quoteSourceFor).not.toHaveBeenCalled();
    expect(prisma.quoteCache.findUnique).not.toHaveBeenCalled();
    expect(providers.options.getOptionQuote).not.toHaveBeenCalled();
  });
  it("never starts option polling for manual-only positions", async () => {
    vi.mocked(prisma.position.findMany).mockResolvedValue([
      {
        assetClass: "OPTION",
        symbol: "MANUAL:V1:BTG:2027-01-15:C:5000:100",
        optionDetails: null,
      },
    ] as never);
    await ensureQuoteJobsForPortfolio("jobs-fixture");
    await vi.advanceTimersByTimeAsync(60000);
    expect(providers.options.getOptionQuote).not.toHaveBeenCalled();
  });
  it("binds saved replay to manual premium and retains manual receipt with no quote timestamp", async () => {
    const t = orderTicketSchema.parse(
      input({ clientOrderId: crypto.randomUUID() }),
    );
    const order = {
      ...t,
      id: "order",
      optionContractSymbol: t.optionContractSymbol,
      quantity: new D(2),
      limitPrice: null,
      quoteSource: "manual",
      fills: [{ id: "fill", positionId: null, price: new D(1.83) }],
    };
    vi.mocked(prisma.order.findUnique).mockResolvedValue(order as never);
    Object.assign(prisma, {
      portfolio: {
        findUniqueOrThrow: vi.fn(async () => ({ cashBalance: new D(9634) })),
      },
      cashLedgerEntry: {
        findFirst: vi.fn(async () => ({
          note: `BUY 2 ${t.optionContractSymbol} (manual) · Manual entry premium per share 1.83`,
        })),
      },
    });
    expect(await executeOrder(t)).toMatchObject({
      replayed: true,
      fillPrice: 1.83,
      simulationBasis: "MANUAL",
      quoteAsOf: null,
    });
    await expect(executeOrder({ ...t, manualPremium: 2 })).rejects.toThrow(
      "different order",
    );
    await expect(executeOrder({ ...t, optionRight: "PUT" })).rejects.toThrow(
      "does not match",
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it("checks manual expiry after waiting for the saved portfolio lock, before writing", async () => {
    const t = orderTicketSchema.parse(input());
    vi.setSystemTime(new Date("2027-01-15T20:59:59Z"));
    const write = vi.fn();
    vi.mocked(prisma.$transaction).mockImplementation(async (action: any) =>
      action({
        $queryRaw: async () => {
          vi.setSystemTime(new Date("2027-01-15T21:00:00Z"));
          return [];
        },
        portfolio: { update: write },
        position: { create: write },
        order: { create: write },
        fill: { create: write },
        cashLedgerEntry: { create: write },
      }),
    );
    await expect(executeOrder(t)).rejects.toThrow("Expired contracts");
    expect(write).not.toHaveBeenCalled();
  });
  it("imports manual identities, premiums, basis and history without transient request fields", async () => {
    const { state, p, ticket } = fixture();
    await guestOrder(state, ticket(), true);
    const symbol = p.positions[0].symbol;
    const tx = {
      portfolio: { create: vi.fn() },
      position: { create: vi.fn() },
      optionPositionDetails: { create: vi.fn() },
      targetScenario: { create: vi.fn() },
      cashLedgerEntry: { createMany: vi.fn() },
      order: { create: vi.fn() },
      fill: { createMany: vi.fn() },
      guestImport: { create: vi.fn() },
      workspaceEntry: { findMany: vi.fn(async () => []), create: vi.fn() },
    };
    vi.mocked(prisma.$transaction).mockImplementation(async (action: any) =>
      action(tx),
    );
    const result = await importGuest(state.key, "profile-owner");
    expect(result.portfolioIds).toEqual([p.id]);
    expect(tx.portfolio.create.mock.calls[0][0].data.userId).toBe(
      "profile-owner",
    );
    expect(tx.position.create.mock.calls[0][0].data.symbol).toBe(symbol);
    expect(
      tx.optionPositionDetails.create.mock.calls[0][0].data.entryPremium.toNumber(),
    ).toBe(1.83);
    const persisted = tx.order.create.mock.calls[0][0].data;
    expect(persisted).toMatchObject({
      quoteSource: "manual",
      optionContractSymbol: symbol,
    });
    expect(persisted).not.toHaveProperty("manualPremium");
    expect(persisted).not.toHaveProperty("optionPricing");
    expect(tx.fill.createMany.mock.calls[0][0].data[0].price.toNumber()).toBe(
      1.83,
    );
  });
});
