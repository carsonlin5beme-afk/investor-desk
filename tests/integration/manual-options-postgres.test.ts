import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { PrismaClient } from "@prisma/client";
vi.mock("@/lib/env", () => ({
  env: { QUOTE_STALE_SECONDS: 120, MARKET_DATA_MODE: "live" },
}));
vi.mock("@/server/providers/factory", () => ({
  quoteSourceFor: () => "unavailable",
  providers: {
    options: {
      getOptionQuote: vi.fn(async () => {
        throw new Error("Feed unavailable");
      }),
    },
    equities: { getQuote: vi.fn(async () => null) },
  },
}));
import { prisma } from "@/lib/prisma";
import { providers } from "@/server/providers/factory";
import { executeOrder, previewOrder } from "@/server/services/order-service";
import { buildPositionProjection } from "@/server/services/projection-service";
import { orderTicketSchema } from "@/server/api/schemas";
import { createGuest, discardGuest } from "@/server/guest/store";
import { createPortfolio, guestOrder } from "@/server/guest/portfolio";
import { importGuest } from "@/server/guest/import";
const enabled = process.env.MANUAL_OPTIONS_POSTGRES === "1";
if (
  enabled &&
  (!process.cwd().startsWith("/private/tmp/investor-desk-manual-options-") ||
    !/^postgresql:\/\/fixture:fixture@127\.0\.0\.1:\d+\/manual_options_audit$/.test(
      process.env.DATABASE_URL ?? "",
    ))
)
  throw new Error(
    "This test requires the explicitly selected disposable manual-options database.",
  );
const ids: string[] = [],
  keys: string[] = [];
const blocker = new PrismaClient();
async function fixture(right: "CALL" | "PUT" = "CALL") {
  const id = randomUUID();
  ids.push(id);
  await prisma.user.create({
    data: {
      id,
      name: "Disposable manual options",
      email: `${id}@example.test`,
    },
  });
  const p = await prisma.portfolio.create({
    data: {
      userId: id,
      name: "Fixture",
      startingCash: 10000,
      cashBalance: 10000,
      cashLedgerEntries: { create: { type: "DEPOSIT", amount: 10000 } },
    },
  });
  const t = (extra = {}) =>
    orderTicketSchema.parse({
      portfolioId: p.id,
      symbol: "BTG",
      assetClass: "OPTION",
      side: "BUY",
      orderType: "MARKET",
      quantity: 2,
      optionRight: right,
      optionStrike: 5,
      optionExpiration: "2027-01-15",
      optionPricing: "MANUAL",
      manualPremium: 1.83,
      clientOrderId: randomUUID(),
      ...extra,
    });
  return { id, p, t };
}
async function state(id: string) {
  const p = await prisma.portfolio.findUniqueOrThrow({
    where: { id },
    include: {
      positions: { include: { optionDetails: true, targetScenario: true } },
      orders: { include: { fills: true } },
      cashLedgerEntries: true,
    },
  });
  return {
    p,
    cash: p.cashBalance.toNumber(),
    positions: p.positions.length,
    orders: p.orders.length,
    fills: p.orders.flatMap((o) => o.fills).length,
    ledger: p.cashLedgerEntries.length,
    ledgerTotal: p.cashLedgerEntries.reduce(
      (n, e) => n + e.amount.toNumber(),
      0,
    ),
    realized: p.orders
      .flatMap((o) => o.fills)
      .reduce((n, f) => n + f.realizedPnL.toNumber(), 0),
  };
}
describe.runIf(enabled)("manual options on disposable PostgreSQL", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-19T16:00:00Z"));
    vi.clearAllMocks();
  });
  afterEach(async () => {
    vi.useRealTimers();
    keys.splice(0).forEach(discardGuest);
    await prisma.user.deleteMany({ where: { id: { in: ids.splice(0) } } });
  });
  afterAll(async () => {
    await blocker.$disconnect();
    await prisma.$disconnect();
  });
  it.each(["CALL", "PUT"] as const)(
    "records saved %s accounting, weighted basis, partial/full sale, replay and quote-free valuation",
    async (right) => {
      const { p, t } = await fixture(right);
      const first = t();
      expect(await previewOrder(first)).toMatchObject({
        estimatedNotional: 366,
        cashAfter: 9634,
        quote: null,
      });
      const bought = await executeOrder(first);
      expect(bought).toMatchObject({
        simulationBasis: "MANUAL",
        quoteAsOf: null,
        quoteSource: "manual",
      });
      const positionId = bought.position!.id;
      await prisma.targetScenario.create({
        data: { positionId, targetMode: "PRICE", targetPrice: 10 },
      });
      await executeOrder(t({ quantity: 1, manualPremium: 2.34 }));
      let current = await state(p.id);
      const h = current.p.positions[0];
      expect(h.avgCost.toNumber()).toBe(2);
      expect(h.optionDetails?.entryPremium.toNumber()).toBe(2);
      expect(h.optionDetails).toMatchObject({
        contracts: 3,
        multiplier: 100,
        right,
        expiration: new Date("2027-01-15T00:00:00Z"),
      });
      expect(await buildPositionProjection(h)).toMatchObject({
        currentPrice: null,
        currentMarketValue: 600,
        priceEstimated: true,
        quoteSource: "manual",
        quoteAsOf: null,
      });
      await executeOrder(t({ quantity: 1, side: "SELL", manualPremium: 3 }));
      current = await state(p.id);
      expect(current.p.positions[0].avgCost.toNumber()).toBe(2);
      expect(current.realized).toBe(100);
      await expect(
        executeOrder(t({ quantity: 3, side: "SELL", manualPremium: 3 })),
      ).rejects.toThrow("quantity owned");
      const close = t({ quantity: 2, side: "SELL", manualPremium: 1 });
      await executeOrder(close);
      current = await state(p.id);
      expect(current).toMatchObject({
        cash: 9900,
        positions: 0,
        orders: 4,
        fills: 4,
        ledger: 5,
        ledgerTotal: 9900,
        realized: -100,
      });
      expect(
        await prisma.targetScenario.findUnique({ where: { positionId } }),
      ).toBeNull();
      vi.setSystemTime(new Date("2028-01-01T12:00:00Z"));
      expect(await executeOrder(close)).toMatchObject({
        replayed: true,
        simulationBasis: "MANUAL",
        quoteAsOf: null,
        fillPrice: 1,
      });
      await expect(
        executeOrder({ ...close, manualPremium: 1.1 }),
      ).rejects.toThrow("different order");
      expect((await state(p.id)).orders).toBe(4);
      expect(providers.options.getOptionQuote).not.toHaveBeenCalled();
    },
  );
  it("serializes simultaneous duplicate/manual buy requests on the real portfolio row", async () => {
    const { p, t } = await fixture();
    await prisma.portfolio.update({
      where: { id: p.id },
      data: { cashBalance: 400 },
    });
    const a = t();
    const result = await Promise.allSettled([
      executeOrder(a),
      executeOrder(a),
      executeOrder(t()),
    ]);
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(await state(p.id)).toMatchObject({
      cash: 34,
      positions: 1,
      orders: 1,
      fills: 1,
    });
  });
  it("keeps identical provider and manual terms in distinct positions", async () => {
    const { p, t } = await fixture();
    await prisma.position.create({
      data: {
        portfolioId: p.id,
        symbol: "BTG270115C00005000",
        assetClass: "OPTION",
        quantity: 2,
        avgCost: 2,
      },
    });
    await executeOrder(t());
    expect((await state(p.id)).positions).toBe(2);
    await executeOrder(t({ side: "SELL", manualPremium: 2 }));
    expect((await state(p.id)).p.positions.map((p) => p.symbol)).toEqual([
      "BTG270115C00005000",
    ]);
  });
  it("imports a manual guest holding/history atomically into only its profile", async () => {
    const { id } = await fixture();
    const { state: guest } = createGuest();
    keys.push(guest.key);
    const p = createPortfolio(guest, {
      name: "Manual guest",
      startingCash: 1000,
    });
    const t = orderTicketSchema.parse({
      portfolioId: p.id,
      symbol: "BTG",
      assetClass: "OPTION",
      side: "BUY",
      orderType: "MARKET",
      quantity: 1,
      optionRight: "CALL",
      optionStrike: 5,
      optionExpiration: "2027-01-15",
      optionPricing: "MANUAL",
      manualPremium: 1.83,
      clientOrderId: randomUUID(),
    });
    await guestOrder(guest, t, true);
    await importGuest(guest.key, id);
    const imported = await state(p.id);
    expect(imported).toMatchObject({
      cash: 817,
      positions: 1,
      orders: 1,
      fills: 1,
      ledgerTotal: 817,
    });
    expect(imported.p.userId).toBe(id);
    expect(imported.p.orders[0].quoteSource).toBe("manual");
    expect(imported.p.positions[0].symbol).toBe(t.optionContractSymbol);
    expect(await importGuest(guest.key, id)).toMatchObject({
      alreadySaved: true,
    });
    await expect(importGuest(guest.key, "wrong-profile")).rejects.toThrow(
      "different profile",
    );
  });
  it("rolls back an expiry crossed while waiting on an actual database lock", async () => {
    const { p, t } = await fixture();
    vi.setSystemTime(new Date("2027-01-15T20:59:59Z"));
    let release!: () => void, acquired!: () => void;
    const ready = new Promise<void>((r) => (acquired = r)),
      gate = new Promise<void>((r) => (release = r));
    const holder = blocker.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Portfolio" WHERE id = ${p.id} FOR UPDATE`;
        acquired();
        await gate;
      },
      { timeout: 15000 },
    );
    await ready;
    const order = executeOrder(t()).then(
      () => null,
      (error) => error as Error,
    );
    try {
      let blocked = false;
      for (let i = 0; i < 100; i++) {
        const counts = await blocker.$queryRaw<
          Array<{ count: bigint }>
        >`SELECT count(*) AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%Portfolio%FOR UPDATE%'`;
        if (Number(counts[0].count)) {
          blocked = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(blocked).toBe(true);
      vi.setSystemTime(new Date("2027-01-15T21:00:01Z"));
    } finally {
      release();
      await holder;
    }
    expect((await order)?.message).toContain("Expired contracts");
    expect(await state(p.id)).toMatchObject({
      cash: 10000,
      positions: 0,
      orders: 0,
      fills: 0,
      ledger: 1,
    });
  }, 20000);
});
