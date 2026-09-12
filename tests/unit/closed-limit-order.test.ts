import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import type { MarketQuote, OrderTicket } from "@/server/domain/types";
import type { ClosedSessionBasis } from "@/lib/quote-status";

const { latest, eligibility, db } = vi.hoisted(() => ({
  latest: vi.fn(),
  eligibility: vi.fn(),
  db: {
    portfolio: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    position: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    order: { findUnique: vi.fn(), create: vi.fn() },
    fill: { create: vi.fn() },
    cashLedgerEntry: { create: vi.fn(), findFirst: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@/lib/env", () => ({ env: { QUOTE_STALE_SECONDS: 120 } }));
vi.mock("@/server/services/quote-service", () => ({
  getLiveQuote: latest,
  quoteMark: () => null,
}));
vi.mock("@/server/providers/factory", () => ({
  providers: {
    equities: {},
    options: { getOptionQuote: vi.fn(async () => null) },
  },
}));
vi.mock("@/server/services/closed-session-simulation", async (original) => ({
  ...(await original<
    typeof import("@/server/services/closed-session-simulation")
  >()),
  closedSessionEligibility: eligibility,
}));
import {
  executeOrder,
  previewOrder,
  resolveTicket,
} from "@/server/services/order-service";
import { createGuest, discardGuest } from "@/server/guest/store";
import { createPortfolio, guestOrder } from "@/server/guest/portfolio";

let quote: MarketQuote;
let basis: ClosedSessionBasis;
let ticket: OrderTicket;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-10T04:30:00Z"));
  vi.clearAllMocks();
  quote = {
    symbol: "PL",
    assetClass: "EQUITY",
    bid: 32,
    ask: 32.05,
    mark: 32.025,
    last: null,
    source: "alpaca-iex",
    asOf: new Date("2026-09-09T20:00:00Z"),
  };
  basis = {
    kind: "CLOSED_SESSION_LIMIT",
    quoteSource: quote.source,
    quoteAsOf: quote.asOf.toISOString(),
    quoteBid: quote.bid!,
    quoteAsk: quote.ask!,
    sessionDate: "2026-09-09",
    nextOpen: "2026-09-10T13:30:00Z",
    validUntil: "2026-09-10T04:31:00Z",
  };
  ticket = {
    portfolioId: "saved-test",
    symbol: "PL",
    assetClass: "EQUITY",
    side: "BUY",
    quantity: 2,
    orderType: "LIMIT",
    limitPrice: 32.1,
    clientOrderId: crypto.randomUUID(),
  };
  latest.mockImplementation(async () => quote);
  eligibility.mockImplementation(async (value) => ({
    basis: value.source === "alpaca-iex" ? { ...basis } : null,
  }));
  db.order.findUnique.mockResolvedValue(null);
  db.cashLedgerEntry.findFirst.mockResolvedValue(null);
  db.portfolio.findUnique.mockResolvedValue({
    id: ticket.portfolioId,
    cashBalance: new Prisma.Decimal(1000),
  });
  db.position.findUnique.mockResolvedValue(null);
  db.position.create.mockImplementation(async ({ data }) => ({
    id: "saved-position",
    ...data,
  }));
  db.order.create.mockImplementation(async ({ data }) => ({
    id: "saved-order",
    ...data,
  }));
  db.fill.create.mockImplementation(async ({ data }) => ({
    id: "saved-fill",
    ...data,
  }));
  db.$queryRaw.mockResolvedValue([]);
  db.$transaction.mockImplementation(async (run) => run(db));
});
afterEach(() => vi.useRealTimers());

describe("closed-session limit order policy shared by profile and guest", () => {
  it("saved replay retains original provenance after the market opens without requesting another quote", async () => {
    const first = await executeOrder({
      ...ticket,
      closedSessionPreview: basis,
    });
    db.order.findUnique.mockResolvedValue({
      ...first.order,
      quantity: new Prisma.Decimal(ticket.quantity),
      limitPrice: new Prisma.Decimal(ticket.limitPrice!),
      optionContractSymbol: null,
      fills: [{ ...first.fill, price: new Prisma.Decimal(first.fillPrice) }],
    });
    db.portfolio.findUniqueOrThrow.mockResolvedValue({
      cashBalance: new Prisma.Decimal(900),
    });
    db.position.findUnique.mockResolvedValue(first.position);
    const note = db.cashLedgerEntry.create.mock.calls[0][0].data.note;
    db.cashLedgerEntry.findFirst.mockResolvedValue({ note });
    vi.setSystemTime(new Date("2026-09-10T15:00:00Z"));
    latest.mockRejectedValue(new Error("No provider access"));
    const replay = await executeOrder(ticket);
    expect(replay).toMatchObject({
      replayed: true,
      quoteSource: first.quoteSource,
      quoteAsOf: first.quoteAsOf,
      simulationBasis: first.simulationBasis,
      fillPrice: first.fillPrice,
      portfolioCashBalance: 900,
    });
    expect(replay.order.id).toBe(first.order.id);
    expect(replay.fill.id).toBe(first.fill.id);
    expect(latest).toHaveBeenCalledTimes(1);
    expect(db.cashLedgerEntry.findFirst).toHaveBeenCalledWith({
      where: {
        id: first.order.id,
        portfolioId: ticket.portfolioId,
        type: "BUY",
      },
      select: { note: true },
    });
    expect(db.order.create).toHaveBeenCalledTimes(1);
    db.cashLedgerEntry.findFirst.mockResolvedValue(null);
    expect(await executeOrder(ticket)).toMatchObject({
      replayed: true,
      quoteAsOf: null,
      simulationBasis: null,
      quoteSource: "alpaca-iex",
    });
  });

  it("guest replay ignores an unrelated ledger row and leaves legacy provenance unknown", async () => {
    const { state } = createGuest();
    try {
      const p = createPortfolio(state, {
        name: "Legacy replay",
        startingCash: 1000,
      });
      const order = {
        ...ticket,
        portfolioId: p.id,
        closedSessionPreview: basis,
      };
      const first = await guestOrder(state, order, true);
      const ledger = p.cashLedgerEntries.at(-1)!;
      expect("execution" in first && ledger.id).toBe(
        "execution" in first && first.execution.orderId,
      );
      const repeat = await guestOrder(state, order, true);
      expect(repeat).toMatchObject({
        execution: {
          replayed: true,
          quoteAsOf: quote.asOf.toISOString(),
          simulationBasis: "CLOSED_SESSION_LIMIT",
        },
      });
      ledger.portfolioId = "unrelated";
      expect(await guestOrder(state, order, true)).toMatchObject({
        execution: { quoteAsOf: null, simulationBasis: null },
      });
      ledger.portfolioId = p.id;
      ledger.type = "DEPOSIT";
      expect(await guestOrder(state, order, true)).toMatchObject({
        execution: { quoteAsOf: null, simulationBasis: null },
      });
      expect(p.orders).toHaveLength(1);
    } finally {
      discardGuest(state.key);
    }
  });
  it("saved preview and execution use ask, preserve cent cash math and audit the historical basis", async () => {
    const preview = await previewOrder(ticket);
    expect(preview).toMatchObject({
      fillable: true,
      estimatedFillPrice: 32.05,
      estimatedNotional: 64.1,
      cashAfter: 935.9,
      closedSession: basis,
    });
    const result = await executeOrder({
      ...ticket,
      closedSessionPreview: basis,
    });
    expect(result).toMatchObject({
      fillPrice: 32.05,
      notional: 64.1,
      portfolioCashBalance: 935.9,
      replayed: false,
      simulationBasis: "CLOSED_SESSION_LIMIT",
      quoteSource: "alpaca-iex",
      quoteAsOf: quote.asOf.toISOString(),
    });
    expect(latest.mock.calls.every((call) => call[2] === true)).toBe(true);
    expect(db.order.create.mock.calls[0][0].data.quoteSource).toBe(
      "alpaca-iex",
    );
    expect(db.cashLedgerEntry.create.mock.calls[0][0].data.note).toContain(
      `Quote at ${quote.asOf.toISOString()}`,
    );
    expect(db.cashLedgerEntry.create.mock.calls[0][0].data.note).toContain(
      "Closed-session limit simulation using last available quote",
    );
  });

  it("guest preview/execution match the saved path, and replay cannot mutate cash twice", async () => {
    const { state } = createGuest();
    try {
      const p = createPortfolio(state, {
        name: "Closed limit",
        startingCash: 1000,
      });
      const order = { ...ticket, portfolioId: p.id };
      expect(await guestOrder(state, order, false)).toMatchObject({
        preview: {
          estimatedFillPrice: 32.05,
          estimatedNotional: 64.1,
          cashAfter: 935.9,
          closedSession: basis,
        },
      });
      const executed = await guestOrder(
        state,
        { ...order, closedSessionPreview: basis },
        true,
      );
      expect(executed).toMatchObject({
        execution: {
          fillPrice: 32.05,
          portfolioCashBalance: 935.9,
          replayed: false,
          simulationBasis: "CLOSED_SESSION_LIMIT",
        },
      });
      expect(p.positions[0].quantity.toNumber()).toBe(2);
      expect(p.positions[0].avgCost.toNumber()).toBe(32.05);
      expect(p.cashLedgerEntries.at(-1)!.note).toContain(
        quote.asOf.toISOString(),
      );
      expect(
        await guestOrder(
          state,
          { ...order, closedSessionPreview: basis },
          true,
        ),
      ).toMatchObject({
        execution: { replayed: true, portfolioCashBalance: 935.9 },
      });
      expect(p.orders).toHaveLength(1);
      expect(
        p.cashLedgerEntries.filter((entry) => entry.type === "BUY"),
      ).toHaveLength(1);
    } finally {
      discardGuest(state.key);
    }
  });

  it("uses the actual ask/bid only when the user's limit crosses", async () => {
    expect(
      (await resolveTicket({ ...ticket, limitPrice: 32 })).decision.fillable,
    ).toBe(false);
    expect(
      (await resolveTicket({ ...ticket, side: "SELL", limitPrice: 32.01 }))
        .decision.fillable,
    ).toBe(false);
    expect(
      (await resolveTicket({ ...ticket, side: "SELL", limitPrice: 31.5 }))
        .decision,
    ).toEqual({ fillable: true, fillPrice: 32 });
    await expect(
      executeOrder({ ...ticket, limitPrice: 32, closedSessionPreview: basis }),
    ).rejects.toThrow("Limit not crossed");
    expect(db.portfolio.update).not.toHaveBeenCalled();
  });

  it("keeps market orders, missing refreshes, delayed sources and open-session stale quotes blocked", async () => {
    await expect(
      resolveTicket({ ...ticket, orderType: "MARKET" }),
    ).rejects.toThrow("simulated limit");
    latest.mockResolvedValueOnce(null);
    await expect(resolveTicket(ticket)).rejects.toThrow("No quote available");
    quote.source = "alpaca-iex-delayed";
    await expect(resolveTicket(ticket)).rejects.toThrow("stale or delayed");
    quote.source = "alpaca-iex";
    eligibility.mockResolvedValue({
      basis: null,
      reason: "Regular session is open",
    });
    await expect(resolveTicket(ticket)).rejects.toThrow(
      "Regular session is open",
    );
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("requires renewed preview when the quote, session or deadline changes", async () => {
    await expect(resolveTicket(ticket, true)).rejects.toThrow("Preview");
    await expect(
      resolveTicket(
        {
          ...ticket,
          closedSessionPreview: { ...basis, quoteAsk: basis.quoteAsk + 1 },
        },
        true,
      ),
    ).rejects.toThrow("changed");
    await expect(
      resolveTicket(
        {
          ...ticket,
          closedSessionPreview: { ...basis, quoteBid: basis.quoteBid - 1 },
        },
        true,
      ),
    ).rejects.toThrow("changed");
    await expect(
      resolveTicket(
        {
          ...ticket,
          closedSessionPreview: { ...basis, quoteAsOf: "2026-09-09T19:59:00Z" },
        },
        true,
      ),
    ).rejects.toThrow("changed");
    await expect(
      resolveTicket(
        {
          ...ticket,
          closedSessionPreview: { ...basis, sessionDate: "2026-09-08" },
        },
        true,
      ),
    ).rejects.toThrow("changed");
    vi.setSystemTime(new Date(basis.validUntil));
    await expect(
      resolveTicket({ ...ticket, closedSessionPreview: basis }, true),
    ).rejects.toThrow("expired");
    quote.asOf = new Date();
    await expect(
      resolveTicket({ ...ticket, closedSessionPreview: basis }, true),
    ).rejects.toThrow("changed");
  });

  it("stops before account mutation when a portfolio lock carries execution across open", async () => {
    basis.nextOpen = "2026-09-10T04:30:20Z";
    basis.validUntil = basis.nextOpen;
    db.$queryRaw.mockImplementation(async () => {
      vi.setSystemTime(new Date(basis.nextOpen));
      return [];
    });
    await expect(
      executeOrder({ ...ticket, closedSessionPreview: basis }),
    ).rejects.toThrow("expired");
    expect(db.portfolio.update).not.toHaveBeenCalled();
    expect(db.order.create).not.toHaveBeenCalled();
    expect(db.fill.create).not.toHaveBeenCalled();
  });

  it("retains cash and ownership protections under the closed-session exception", async () => {
    db.portfolio.findUnique.mockResolvedValue({
      id: ticket.portfolioId,
      cashBalance: new Prisma.Decimal(1),
    });
    await expect(previewOrder(ticket)).rejects.toThrow("Insufficient cash");
    await expect(
      previewOrder({ ...ticket, side: "SELL", limitPrice: 31 }),
    ).rejects.toThrow("Short selling is disabled");
    expect(db.portfolio.update).not.toHaveBeenCalled();
  });
});
