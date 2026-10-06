import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  token: "",
  profile: vi.fn(),
  quote: vi.fn(),
  db: { guestImport: { findUnique: vi.fn() }, $transaction: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.db }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (mocks.token ? { value: mocks.token } : undefined),
  }),
}));
vi.mock("@/server/auth/access", () => ({ currentProfile: mocks.profile }));
vi.mock("@/server/providers/factory", () => ({
  isDemo: true,
  equitiesConfigured: () => true,
  equityFeedConfigured: () => "demo",
  optionsConfigured: () => true,
  providers: {
    fundamentals: { getSharesOutstanding: vi.fn(async () => null) },
  },
}));
vi.mock("@/server/services/quote-service", () => ({
  getLiveQuote: mocks.quote,
  quoteMark: () => null,
}));
vi.mock("@/server/services/order-service", async () => {
  const { decideFill } = await import("@/server/domain/fill-engine");
  return {
    resolveTicket: vi.fn(
      async (ticket: import("@/server/domain/types").OrderTicket) => {
        const symbol = ticket.optionContractSymbol ?? ticket.symbol;
        const price = ticket.assetClass === "OPTION" ? 5 : 100;
        const quote = {
          symbol,
          assetClass: ticket.assetClass,
          bid: price,
          ask: price,
          mark: price,
          last: null,
          source: "demo",
          asOf: new Date(),
        };
        return { symbol, quote, decision: decideFill(ticket, quote) };
      },
    ),
    // Quote/session freshness is covered by order-service tests. This fixture
    // isolates the real guest cash constraint and history-writing code.
    assertExecutionCurrent: vi.fn(),
  };
});

import {
  createGuest,
  discardGuest,
  getGuest,
  type GuestPortfolio,
} from "@/server/guest/store";
import {
  adjustCash,
  createPortfolio,
  guestOrder,
  guestTarget,
  presentGuest,
  updateGuestMargin,
} from "@/server/guest/portfolio";
import { guestResponse } from "@/server/guest/http";
import { importGuest } from "@/server/guest/import";
import {
  GET as workspaceGET,
  PUT as workspacePUT,
} from "@/app/api/workspace/route";
import {
  aggregateMargin,
  defaultMarginSettings,
  type MarginSettings,
} from "@/lib/margin";
import { snapshot, type SavedScenario } from "@/lib/studio";
import type { Portfolio } from "@/lib/desk-types";

const tx = {
  portfolio: { create: vi.fn() },
  position: { create: vi.fn() },
  optionPositionDetails: { create: vi.fn() },
  targetScenario: { create: vi.fn() },
  cashLedgerEntry: { createMany: vi.fn() },
  order: { create: vi.fn() },
  fill: { createMany: vi.fn() },
  guestImport: { create: vi.fn() },
  workspaceEntry: { findMany: vi.fn(), create: vi.fn() },
};
const keys: string[] = [];
const terms: MarginSettings = {
  debt: 10000,
  aprPercent: 12.75,
  maintenancePercent: 30,
  dayCountBasis: 365,
};
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function guest() {
  const g = createGuest();
  keys.push(g.state.key);
  mocks.token = g.token;
  return g;
}
function call(id: string, method = "GET", body?: unknown) {
  return guestResponse(
    new Request(`http://127.0.0.1:3000/api/portfolios/${id}/margin`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}
const buy = (id: string, quantity = 1) => ({
  portfolioId: id,
  assetClass: "EQUITY",
  symbol: "TSLA",
  side: "BUY",
  quantity,
  orderType: "MARKET",
  clientOrderId: crypto.randomUUID(),
});
async function populated() {
  const g = guest();
  const p = createPortfolio(g.state, {
    name: "Margin scenario",
    startingCash: 25000,
  });
  await guestOrder(g.state, buy(p.id, 200), true);
  await guestOrder(
    g.state,
    {
      ...buy(p.id, 10),
      assetClass: "OPTION",
      symbol: "BTG",
      optionContractSymbol: "BTG301220C00005000",
      optionRight: "CALL",
      optionStrike: 5,
      optionExpiration: "2030-12-20T20:00:00Z",
    },
    true,
  );
  await guestTarget(g.state, p.positions[0].id, {
    targetMode: "PRICE",
    targetPrice: 120,
  });
  return { ...g, p };
}
function financialRecords(p: GuestPortfolio) {
  return json({
    startingCash: p.startingCash,
    cashBalance: p.cashBalance,
    positions: p.positions,
    orders: p.orders,
    cashLedgerEntries: p.cashLedgerEntries,
  });
}
async function wirePortfolio(p: GuestPortfolio): Promise<Portfolio> {
  // This is the same decimal/date serialization consumed by the client.
  return JSON.parse(JSON.stringify(await presentGuest(p)));
}
async function saveSnapshot(p: GuestPortfolio) {
  const scenario = snapshot(
    [await wirePortfolio(p)],
    "Frozen guest assumptions",
  );
  const key = `scenario:${scenario.id}`;
  const response = await workspacePUT(
    new Request("http://127.0.0.1:3000/api/workspace", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, version: 0, value: scenario }),
    }),
  );
  expect(response.status).toBe(200);
  return { scenario, key, entry: (await response.json()).entry };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.token = "";
  mocks.profile.mockResolvedValue(null);
  mocks.quote.mockResolvedValue(null);
  mocks.db.guestImport.findUnique.mockResolvedValue(null);
  mocks.db.$transaction.mockImplementation(async (callback) => callback(tx));
  tx.workspaceEntry.findMany.mockResolvedValue([]);
});
afterEach(() => {
  keys.splice(0).forEach(discardGuest);
  vi.restoreAllMocks();
});

describe("guest margin defaults, ownership and persistence", () => {
  it("creates zero modeled debt without changing initial cash or funding history", async () => {
    const { state } = guest();
    const p = createPortfolio(state, {
      name: "Blank debt",
      startingCash: 1234.56,
    });
    expect(p.marginDebt.toNumber()).toBe(0);
    expect(p.marginAprPercent).toBe(0);
    expect(p.marginMaintenancePercent).toBe(25);
    expect(p.marginDayCountBasis).toBe(360);
    expect(await (await call(p.id))!.json()).toEqual({
      portfolioId: p.id,
      margin: defaultMarginSettings,
    });
    const view = await presentGuest(p);
    expect(view.margin).toEqual(defaultMarginSettings);
    expect(view.currentValue).toBe(1234.56);
    expect(view.grossCurrentValue).toBe(1234.56);
    expect(view.netEquity).toBe(1234.56);
    expect(p.cashBalance.toNumber()).toBe(1234.56);
    expect(p.startingCash.toNumber()).toBe(1234.56);
    expect(p.positions).toEqual([]);
    expect(p.orders).toEqual([]);
    expect(p.cashLedgerEntries).toHaveLength(1);
    expect(p.cashLedgerEntries[0].amount.toNumber()).toBe(1234.56);
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it.each([360, 365] as const)(
    "saves all entered terms and reloads principal with a %s-day basis",
    async (dayCountBasis) => {
      const { state, p } = await populated();
      const original = financialRecords(p);
      const entered = { ...terms, debt: 10000.01, dayCountBasis };
      const response = await call(p.id, "PATCH", entered);
      expect(response?.status).toBe(200);
      expect(await response!.json()).toEqual({
        portfolioId: p.id,
        margin: entered,
      });
      expect(getGuest(state.key)?.portfolios[0]).toBe(p);
      for (let reload = 0; reload < 2; reload++) {
        expect(await (await call(p.id))!.json()).toEqual({
          portfolioId: p.id,
          margin: entered,
        });
        expect((await presentGuest(p)).margin).toEqual(entered);
      }
      expect(financialRecords(p)).toEqual(original);
      expect(mocks.db.$transaction).not.toHaveBeenCalled();
    },
  );

  it("honors explicit zero APR when debt is nonzero", async () => {
    const { state } = guest();
    const p = createPortfolio(state, {
      name: "Zero interest",
      startingCash: 500,
    });
    const entered = { ...terms, debt: 600, aprPercent: 0 };
    updateGuestMargin(state, p.id, entered);
    const view = await presentGuest(p);
    expect(view.margin).toEqual(entered);
    expect(view.netEquity).toBe(-100);
    expect(p.cashBalance.toNumber()).toBe(500);
  });

  it.each(["GET", "PATCH"])(
    "refuses %s of a different guest's portfolio without changing either workspace",
    async (method) => {
      const a = guest();
      const p = createPortfolio(a.state, {
        name: "Private",
        startingCash: 500,
      });
      updateGuestMargin(a.state, p.id, terms);
      const original = json(p);
      const b = guest();
      const response = await call(
        p.id,
        method,
        method === "PATCH" ? { ...terms, debt: 0 } : undefined,
      );
      expect(response?.status).toBe(404);
      expect(await response!.json()).toEqual({ error: "Portfolio not found." });
      expect(json(p)).toEqual(original);
      expect(b.state.portfolios).toEqual([]);
      expect(mocks.db.$transaction).not.toHaveBeenCalled();
    },
  );

  it("returns control to saved-profile routes before reading guest portfolios", async () => {
    const { state } = guest();
    const p = createPortfolio(state, { name: "Temporary", startingCash: 500 });
    mocks.profile.mockResolvedValue({ id: "signed-in-owner" });
    expect(await call(p.id, "PATCH", terms)).toBeNull();
    expect(p.marginDebt.toNumber()).toBe(0);
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("serializes complete concurrent settings without mixing the entered terms", async () => {
    const { state } = guest();
    const p = createPortfolio(state, {
      name: "Two editors",
      startingCash: 500,
    });
    const later: MarginSettings = {
      debt: 250,
      aprPercent: 0,
      maintenancePercent: 75,
      dayCountBasis: 360,
    };
    const responses = await Promise.all([
      call(p.id, "PATCH", terms),
      call(p.id, "PATCH", later),
    ]);
    expect(responses.map((r) => r?.status)).toEqual([200, 200]);
    expect(await responses[0]!.json()).toEqual({
      portfolioId: p.id,
      margin: terms,
    });
    expect(await responses[1]!.json()).toEqual({
      portfolioId: p.id,
      margin: later,
    });
    expect(await (await call(p.id))!.json()).toEqual({
      portfolioId: p.id,
      margin: later,
    });
    expect(p.cashBalance.toNumber()).toBe(500);
    expect(p.cashLedgerEntries).toHaveLength(1);
  });

  it("reads missing legacy guest fields as zero debt and default assumptions", async () => {
    const { p } = await populated();
    for (const field of [
      "marginDebt",
      "marginAprPercent",
      "marginMaintenancePercent",
      "marginDayCountBasis",
    ])
      Reflect.deleteProperty(p, field);
    const before = financialRecords(p);
    expect(await (await call(p.id))!.json()).toEqual({
      portfolioId: p.id,
      margin: defaultMarginSettings,
    });
    const view = await presentGuest(p);
    expect(view.margin).toEqual(defaultMarginSettings);
    expect(view.netEquity).toBe(25000);
    expect(view.projectedNetWorth).toBe(29000);
    expect(financialRecords(p)).toEqual(before);
  });
});

describe("guest margin mutation validation and cash protection", () => {
  it.each([
    [
      "omitted debt",
      { aprPercent: 5, maintenancePercent: 30, dayCountBasis: 360 },
    ],
    ["omitted APR", { debt: 500, maintenancePercent: 30, dayCountBasis: 360 }],
    ["omitted maintenance", { debt: 500, aprPercent: 5, dayCountBasis: 360 }],
    ["omitted day basis", { debt: 500, aprPercent: 5, maintenancePercent: 30 }],
    ["blank debt", { ...terms, debt: "" }],
    ["blank APR", { ...terms, aprPercent: "" }],
    ["negative debt", { ...terms, debt: -1 }],
    ["negative APR", { ...terms, aprPercent: -1 }],
    ["subcent debt", { ...terms, debt: 1.001 }],
    ["overflow debt", { ...terms, debt: 1e12 + 0.01 }],
    ["low maintenance", { ...terms, maintenancePercent: 24 }],
    ["high maintenance", { ...terms, maintenancePercent: 101 }],
    ["invalid day basis", { ...terms, dayCountBasis: 366 }],
    ["unknown cash field", { ...terms, cashBalance: 99999 }],
  ])(
    "rejects %s and retains the prior complete account",
    async (_name, body) => {
      const { state } = guest();
      const p = createPortfolio(state, { name: "Retained", startingCash: 500 });
      updateGuestMargin(state, p.id, terms);
      const original = json(p);
      expect((await call(p.id, "PATCH", body))?.status).toBe(400);
      expect(json(p)).toEqual(original);
      expect(mocks.db.$transaction).not.toHaveBeenCalled();
    },
  );

  it.each([
    "{",
    '{"debt":1e309,"aprPercent":5,"maintenancePercent":30,"dayCountBasis":360}',
  ])(
    "rejects malformed or nonfinite JSON without changing debt: %s",
    async (body) => {
      const { state } = guest();
      const p = createPortfolio(state, { name: "Retained", startingCash: 500 });
      updateGuestMargin(state, p.id, terms);
      const original = json(p);
      const response = await guestResponse(
        new Request(`http://127.0.0.1:3000/api/portfolios/${p.id}/margin`, {
          method: "PATCH",
          body,
        }),
      );
      expect(response?.status).toBe(400);
      expect(json(p)).toEqual(original);
      expect((await call(p.id, "PATCH", { ...terms, debt: 250 }))?.status).toBe(
        200,
      );
      expect((await presentGuest(p)).margin.debt).toBe(250);
    },
  );

  it("never turns entered debt into buying cash or changes pre-existing trading limits", async () => {
    const { state } = guest();
    const p = createPortfolio(state, {
      name: "Cash only execution",
      startingCash: 100,
    });
    const overspend = buy(p.id, 2);
    await expect(guestOrder(state, overspend, false)).rejects.toThrow(
      "Insufficient cash balance",
    );
    const before = financialRecords(p);
    updateGuestMargin(state, p.id, { ...terms, debt: 100000 });
    expect(financialRecords(p)).toEqual(before);
    await expect(guestOrder(state, overspend, false)).rejects.toThrow(
      "Insufficient cash balance",
    );
    await expect(guestOrder(state, overspend, true)).rejects.toThrow(
      "Insufficient cash balance",
    );
    expect(financialRecords(p)).toEqual(before);
    const preview = await guestOrder(state, buy(p.id, 1), false);
    expect(preview).toMatchObject({
      preview: { cashBefore: 100, cashAfter: 0, estimatedNotional: 100 },
    });
    expect(financialRecords(p)).toEqual(before);
    const filled = await guestOrder(state, buy(p.id, 1), true);
    expect(filled).toMatchObject({
      execution: { portfolioCashBalance: 0, notional: 100 },
    });
    expect(p.marginDebt.toNumber()).toBe(100000);
    expect(p.cashLedgerEntries).toHaveLength(2);
    expect(p.cashLedgerEntries[1].amount.toNumber()).toBe(-100);
  });
});

describe("guest gross assets, net equity and account maintenance", () => {
  it("includes options in gross assets, excludes them from collateral and subtracts principal once", async () => {
    const { state, p } = await populated();
    updateGuestMargin(state, p.id, terms);
    const view = await presentGuest(p);
    expect(view).toMatchObject({
      cashBalance: 0,
      startingCash: 25000,
      equitiesValue: 20000,
      optionsValue: 5000,
      grossCurrentValue: 25000,
      netEquity: 15000,
      currentValue: 15000,
      grossProjectedValue: 29000,
      projectedNetWorth: 19000,
      grossIntrinsicValue: 29000,
      intrinsicNetWorth: 19000,
      projectedPositionsTotal: 29000,
      marginSummary: {
        debt: 10000,
        grossValue: 25000,
        netEquity: 15000,
        marginEquity: 10000,
        maintenanceRequired: 6000,
        maintenanceExcess: 4000,
        maintenanceShortfall: 0,
      },
    });
    expect(
      view.positions.every((holding) => holding.projection.priceEstimated),
    ).toBe(true);
    expect(
      view.positions.every((holding) => holding.projection.quoteStale),
    ).toBe(true);
    expect(
      view.positions.every(
        (holding) => holding.projection.valuationBasis === "COST_BASIS",
      ),
    ).toBe(true);
    expect(
      view.positions.every(
        (holding) => holding.projection.quoteSource === "unavailable",
      ),
    ).toBe(true);
    const response = await guestResponse(
      new Request(`http://127.0.0.1:3000/api/portfolios/${p.id}/projection`),
    );
    expect(response?.status).toBe(200);
    expect(await response!.json()).toMatchObject({
      grossCurrentValue: 25000,
      netEquity: 15000,
      grossProjectedValue: 29000,
      projectedNetWorth: 19000,
      grossIntrinsicValue: 29000,
      intrinsicNetWorth: 19000,
      projectedPositionsTotal: 29000,
      margin: terms,
      marginSummary: view.marginSummary,
    });
    const detail = await guestResponse(
      new Request(`http://127.0.0.1:3000/api/portfolios/${p.id}`),
    );
    expect((await detail!.json()).portfolio).toMatchObject({
      grossCurrentValue: 25000,
      netEquity: 15000,
      margin: terms,
    });
  });

  it("keeps each positive shortfall even when another portfolio has surplus", async () => {
    const { state } = guest();
    const deficient = createPortfolio(state, {
      name: "Deficient",
      startingCash: 12000,
    });
    const surplus = createPortfolio(state, {
      name: "Surplus",
      startingCash: 20000,
    });
    await guestOrder(state, buy(deficient.id, 120), true);
    await guestOrder(state, buy(surplus.id, 200), true);
    updateGuestMargin(state, deficient.id, terms);
    updateGuestMargin(state, surplus.id, { ...terms, debt: 0 });
    const response = await guestResponse(
      new Request("http://127.0.0.1:3000/api/desk"),
    );
    const views: Portfolio[] = (await response!.json()).portfolios;
    expect(views[0].marginSummary).toMatchObject({
      netEquity: 2000,
      maintenanceRequired: 3600,
      maintenanceExcess: -1600,
      maintenanceShortfall: 1600,
    });
    expect(views[1].marginSummary).toMatchObject({
      maintenanceExcess: 14000,
      maintenanceShortfall: 0,
    });
    expect(
      aggregateMargin(views.map((view) => view.marginSummary ?? null)),
    ).toMatchObject({ maintenanceExcess: 12400, maintenanceShortfall: 1600 });
  });
});

describe("guest margin and frozen scenario transfer (mocked transaction, no database)", () => {
  it("imports all four margin fields and preserves cash, holdings, ledger and history", async () => {
    const { state, p } = await populated();
    const entered: MarginSettings = {
      debt: 10000.01,
      aprPercent: 8.125,
      maintenancePercent: 37.5,
      dayCountBasis: 365,
    };
    updateGuestMargin(state, p.id, entered);
    const before = financialRecords(p);
    const { positions, orders, cashLedgerEntries, ...portfolio } = p;
    const result = await importGuest(state.key, "profile-a");
    expect(result).toEqual({ portfolioIds: [p.id], alreadySaved: false });
    expect(tx.portfolio.create).toHaveBeenCalledExactlyOnceWith({
      data: { ...portfolio, userId: "profile-a" },
    });
    const saved = tx.portfolio.create.mock.calls[0][0].data;
    expect(saved.marginDebt.toNumber()).toBe(10000.01);
    expect(saved.marginAprPercent).toBe(8.125);
    expect(saved.marginMaintenancePercent).toBe(37.5);
    expect(saved.marginDayCountBasis).toBe(365);
    expect(saved.startingCash.toNumber()).toBe(25000);
    expect(saved.cashBalance.toNumber()).toBe(0);
    expect(tx.cashLedgerEntry.createMany).toHaveBeenCalledExactlyOnceWith({
      data: cashLedgerEntries,
    });
    expect(tx.position.create).toHaveBeenCalledTimes(2);
    positions.forEach(
      ({ optionDetails, targetScenario, ...position }, index) => {
        expect(tx.position.create.mock.calls[index][0]).toEqual({
          data: position,
        });
        if (optionDetails)
          expect(tx.optionPositionDetails.create).toHaveBeenCalledWith({
            data: optionDetails,
          });
        if (targetScenario)
          expect(tx.targetScenario.create).toHaveBeenCalledWith({
            data: targetScenario,
          });
      },
    );
    orders.forEach(({ fills, ...order }, index) => {
      const created = tx.order.create.mock.calls[index][0].data;
      expect(created).toEqual({ ...order, clientOrderId: expect.any(String) });
      expect(created.clientOrderId).toMatch(/^[a-f0-9-]{36}$/);
      expect(created.clientOrderId).not.toBe(order.clientOrderId);
      expect(tx.fill.createMany.mock.calls[index][0]).toEqual({ data: fills });
    });
    expect(financialRecords(p)).toEqual(before);
    expect(mocks.db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 15000,
      timeout: 60000,
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(tx.guestImport.create).toHaveBeenCalledExactlyOnceWith({
      data: { tokenHash: state.key, userId: "profile-a", portfolioIds: [p.id] },
    });
    expect(state.imported).toBe(true);
    expect(getGuest(state.key)).toBeNull();
  });

  it("materializes safe defaults when importing an older in-memory guest portfolio", async () => {
    const { state } = guest();
    const p = createPortfolio(state, { name: "Legacy", startingCash: 1000 });
    for (const field of [
      "marginDebt",
      "marginAprPercent",
      "marginMaintenancePercent",
      "marginDayCountBasis",
    ])
      Reflect.deleteProperty(p, field);
    const before = financialRecords(p);
    await importGuest(state.key, "profile-a");
    const saved = tx.portfolio.create.mock.calls[0][0].data;
    expect(saved.marginDebt.toNumber()).toBe(0);
    expect(saved.marginAprPercent).toBe(0);
    expect(saved.marginMaintenancePercent).toBe(25);
    expect(saved.marginDayCountBasis).toBe(360);
    expect(saved.cashBalance.toNumber()).toBe(1000);
    expect(financialRecords(p)).toEqual(before);
  });

  it("retains the complete guest terms and records after failed import, then permits retry", async () => {
    const { state, p } = await populated();
    updateGuestMargin(state, p.id, terms);
    const original = json(p);
    tx.portfolio.create.mockRejectedValueOnce(
      new Error("test transaction aborted"),
    );
    await expect(importGuest(state.key, "profile-a")).rejects.toThrow(
      "test transaction aborted",
    );
    expect(state.imported).toBe(false);
    expect(getGuest(state.key)?.portfolios[0]).toBe(p);
    expect(json(p)).toEqual(original);
    expect(tx.guestImport.create).not.toHaveBeenCalled();
    expect(await (await call(p.id))!.json()).toEqual({
      portfolioId: p.id,
      margin: terms,
    });
    expect((await importGuest(state.key, "profile-a")).alreadySaved).toBe(
      false,
    );
    expect(
      tx.portfolio.create.mock.calls[1][0].data.marginDebt.toNumber(),
    ).toBe(10000);
    expect(tx.guestImport.create).toHaveBeenCalledTimes(1);
  });

  it("persists frozen cash and margin terms independently of later live portfolio edits", async () => {
    const { state, p } = await populated();
    updateGuestMargin(state, p.id, terms);
    const { scenario, key, entry } = await saveSnapshot(p);
    expect(entry.version).toBe(1);
    expect(entry.value.portfolioSnapshots).toEqual([
      { id: p.id, name: p.name, cash: 0, margin: terms },
    ]);
    const frozen = json(scenario);
    const liveTerms: MarginSettings = {
      debt: 9000,
      aprPercent: 0,
      maintenancePercent: 50,
      dayCountBasis: 360,
    };
    expect((await call(p.id, "PATCH", liveTerms))?.status).toBe(200);
    adjustCash(state, p.id, { type: "DEPOSIT", amount: 100 });
    const reloaded = (await (await workspaceGET()).json()).entries[0];
    expect(reloaded.value).toEqual(frozen);
    expect(state.entries?.[key].value).toEqual(frozen);
    expect((await presentGuest(p)).margin).toEqual(liveTerms);
    expect(p.cashBalance.toNumber()).toBe(100);
    expect(mocks.db.$transaction).not.toHaveBeenCalled();
  });

  it("copies frozen assumptions unchanged during guest import, including a saved-ID collision", async () => {
    const { state, p } = await populated();
    updateGuestMargin(state, p.id, terms);
    const { scenario, key } = await saveSnapshot(p);
    const frozen = json(scenario);
    updateGuestMargin(state, p.id, {
      debt: 9000,
      aprPercent: 0,
      maintenancePercent: 50,
      dayCountBasis: 360,
    });
    adjustCash(state, p.id, { type: "DEPOSIT", amount: 100 });
    tx.workspaceEntry.findMany.mockResolvedValue([{ key }]);
    await importGuest(state.key, "profile-a");
    const live = tx.portfolio.create.mock.calls[0][0].data;
    expect(live.cashBalance.toNumber()).toBe(100);
    expect(live.marginDebt.toNumber()).toBe(9000);
    const saved = tx.workspaceEntry.create.mock.calls[0][0].data;
    expect(saved.userId).toBe("profile-a");
    expect(saved.version).toBe(1);
    expect(saved.updatedAt).toBeInstanceOf(Date);
    expect(saved.key).toBe(`scenario:${saved.value.id}`);
    expect(saved.key).not.toBe(key);
    expect(saved.value).toEqual({ ...frozen, id: saved.value.id });
    expect(
      (saved.value as SavedScenario).portfolioSnapshots?.[0].margin,
    ).toEqual(terms);
    expect(saved.value.cash).toBe(0);
    expect(scenario).toEqual(frozen);
  });
});
