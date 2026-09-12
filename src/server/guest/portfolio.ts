import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  createPortfolioSchema,
  cashAdjustSchema,
  orderTicketSchema,
  targetScenarioSchema,
} from "@/server/api/schemas";
import {
  resolveTicket,
  assertExecutionCurrent,
} from "@/server/services/order-service";
import {
  auditQuoteMetadata,
  executionAuditNote,
} from "@/server/services/closed-session-simulation";
import { estimateOrderNotional } from "@/server/domain/fill-engine";
import { decodeContract } from "@/server/providers/demo";
import { providers } from "@/server/providers/factory";
import {
  buildPositionProjection,
  aggregatePortfolioProjection,
} from "@/server/services/projection-service";
import {
  GuestWorkspace,
  GuestPortfolio,
  GuestPosition,
  guestId,
  guestLimit,
} from "./store";
const D = Prisma.Decimal;
export class GuestError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function ownedPortfolio(state: GuestWorkspace, id: string) {
  const p = state.portfolios.find((p) => p.id === id);
  if (!p) throw new GuestError("Portfolio not found.", 404);
  return p;
}
export function ownedPosition(state: GuestWorkspace, id: string) {
  const p = state.portfolios
    .flatMap((p) => p.positions)
    .find((p) => p.id === id);
  if (!p) throw new GuestError("Position not found.", 404);
  return p;
}
export async function presentGuest(p: GuestPortfolio) {
  const positions = await Promise.all(
    p.positions.map(async (position) => ({
      ...position,
      quantity: position.quantity.toNumber(),
      avgCost: position.avgCost.toNumber(),
      projection: await buildPositionProjection(position),
    })),
  );
  const cashBalance = p.cashBalance.toNumber();
  const equitiesValue = positions
    .filter((p) => p.assetClass === "EQUITY")
    .reduce((n, p) => n + p.projection.currentMarketValue, 0);
  const optionsValue = positions
    .filter((p) => p.assetClass === "OPTION")
    .reduce((n, p) => n + p.projection.currentMarketValue, 0);
  return {
    id: p.id,
    name: p.name,
    baseCurrency: p.baseCurrency,
    startingCash: p.startingCash.toNumber(),
    cashBalance,
    currentValue: cashBalance + equitiesValue + optionsValue,
    equitiesValue,
    optionsValue,
    positionCount: positions.length,
    ...aggregatePortfolioProjection(
      cashBalance,
      positions.map((p) => p.projection),
    ),
    positions,
    orders: [...p.orders].reverse().slice(0, 80),
    ledger: [...p.cashLedgerEntries].reverse().slice(0, 80),
  };
}
export function createPortfolio(state: GuestWorkspace, body: unknown) {
  const input = createPortfolioSchema.parse(body);
  if (state.portfolios.length >= 20)
    throw new GuestError(
      "Sign in to save your 20 guest portfolios before creating more.",
    );
  guestLimit(state);
  const now = new Date(),
    id = guestId();
  const p: GuestPortfolio = {
    id,
    userId: null,
    ...input,
    startingCash: new D(input.startingCash),
    cashBalance: new D(input.startingCash),
    createdAt: now,
    updatedAt: now,
    positions: [],
    orders: [],
    cashLedgerEntries: [
      {
        id: guestId(),
        portfolioId: id,
        type: "DEPOSIT",
        amount: new D(input.startingCash),
        note: "Initial funding",
        createdAt: now,
      },
    ],
  };
  state.portfolios.push(p);
  return p;
}
export function adjustCash(state: GuestWorkspace, id: string, body: unknown) {
  const input = cashAdjustSchema.parse(body),
    p = ownedPortfolio(state, id);
  guestLimit(state);
  const delta = new D(input.amount).times(input.type === "DEPOSIT" ? 1 : -1);
  const next = p.cashBalance.plus(delta);
  if (next.lessThan(0))
    throw new GuestError("Insufficient cash balance for withdrawal.");
  p.cashBalance = next;
  p.updatedAt = new Date();
  p.cashLedgerEntries.push({
    id: guestId(),
    portfolioId: id,
    type: input.type,
    amount: delta,
    note: input.note ?? null,
    createdAt: new Date(),
  });
  return { portfolioId: id, cashBalance: next.toNumber() };
}
function executionResult(
  p: GuestPortfolio,
  order: GuestPortfolio["orders"][number],
  replayed = true,
) {
  const fill = order.fills[0],
    position = p.positions.find((p) => p.id === fill.positionId);
  return {
    execution: {
      orderId: order.id,
      replayed,
      quoteSource: order.quoteSource,
      ...auditQuoteMetadata(
        p.cashLedgerEntries.find(
          (entry) =>
            entry.id === order.id &&
            entry.portfolioId === p.id &&
            entry.type === order.side,
        )?.note,
      ),
      fillId: fill.id,
      fillPrice: fill.price.toNumber(),
      notional: estimateOrderNotional(
        { quantity: fill.quantity.toNumber(), assetClass: order.assetClass },
        fill.price.toNumber(),
      ),
      portfolioCashBalance: p.cashBalance.toNumber(),
      position: position
        ? {
            id: position.id,
            symbol: position.symbol,
            assetClass: position.assetClass,
            quantity: position.quantity.toNumber(),
            avgCost: position.avgCost.toNumber(),
          }
        : null,
    },
  };
}
export async function guestOrder(
  state: GuestWorkspace,
  body: unknown,
  execute: boolean,
) {
  const ticket = orderTicketSchema.parse(body),
    p = ownedPortfolio(state, ticket.portfolioId);
  const previous = ticket.clientOrderId
    ? state.portfolios
        .flatMap((p) => p.orders)
        .find((o) => o.clientOrderId === ticket.clientOrderId)
    : null;
  if (execute && previous) {
    if (
      previous.portfolioId !== ticket.portfolioId ||
      previous.symbol !== ticket.symbol ||
      previous.assetClass !== ticket.assetClass ||
      previous.side !== ticket.side ||
      !previous.quantity.equals(ticket.quantity) ||
      previous.orderType !== ticket.orderType ||
      (previous.limitPrice?.toNumber() ?? null) !==
        (ticket.limitPrice ?? null) ||
      previous.optionContractSymbol !== (ticket.optionContractSymbol ?? null)
    )
      throw new GuestError(
        "This submission ID was already used for a different order.",
      );
    return executionResult(p, previous);
  }
  const { symbol, quote, decision, closedSession } = await resolveTicket(
    ticket,
    execute,
  );
  if (!decision.fillable || decision.fillPrice == null) {
    if (execute) throw new GuestError(decision.reason ?? "Order not fillable.");
    return { preview: { ...decision, quote, closedSession } };
  }
  const fillPrice = decision.fillPrice,
    notional = estimateOrderNotional(ticket, fillPrice);
  const existing = p.positions.find(
    (x) => x.symbol === symbol && x.assetClass === ticket.assetClass,
  );
  if (ticket.side === "BUY" && p.cashBalance.lessThan(notional))
    throw new GuestError(
      "Insufficient cash balance. Reduce quantity or add simulated cash.",
    );
  if (
    ticket.side === "SELL" &&
    (!existing || existing.quantity.lessThan(ticket.quantity))
  )
    throw new GuestError(
      "Cannot sell more than the quantity owned. Short selling is disabled.",
    );
  if (
    notional < 0.01 &&
    !(ticket.side === "SELL" && existing?.quantity.equals(ticket.quantity))
  )
    throw new GuestError(
      "Minimum order value is $0.01, except when closing an entire residual position.",
    );
  const nextCash = p.cashBalance.plus(
    ticket.side === "BUY" ? -notional : notional,
  );
  if (!execute)
    return {
      preview: {
        fillable: true,
        estimatedFillPrice: fillPrice,
        estimatedNotional: notional,
        cashBefore: p.cashBalance.toNumber(),
        cashAfter: nextCash.toNumber(),
        ownedQuantity: existing?.quantity.toNumber() ?? 0,
        quote,
        closedSession,
        fees: 0,
      },
    };
  guestLimit(state);
  assertExecutionCurrent(ticket, quote, closedSession);
  const now = new Date(),
    quantity = (existing?.quantity ?? new D(0)).plus(
      ticket.side === "BUY" ? ticket.quantity : -ticket.quantity,
    );
  const avgCost =
    ticket.side === "BUY"
      ? (existing?.quantity.times(existing.avgCost) ?? new D(0))
          .plus(new D(ticket.quantity).times(fillPrice))
          .dividedBy(quantity)
          .toDecimalPlaces(6)
      : existing!.avgCost;
  const realizedPnL =
    ticket.side === "SELL"
      ? new D(fillPrice)
          .minus(existing!.avgCost)
          .times(ticket.quantity)
          .times(ticket.assetClass === "OPTION" ? 100 : 1)
          .toDecimalPlaces(6)
      : new D(0);
  const position: GuestPosition | null = quantity.isZero()
    ? null
    : {
        id: existing?.id ?? guestId(),
        portfolioId: p.id,
        symbol,
        assetClass: ticket.assetClass,
        quantity,
        avgCost,
        marketValue: new D(0),
        unrealizedPnL: new D(0),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        targetScenario: existing?.targetScenario ?? null,
        optionDetails: existing?.optionDetails ?? null,
      };
  if (position && ticket.assetClass === "OPTION")
    position.optionDetails = {
      positionId: position.id,
      ...decodeContract(symbol),
      strike: new D(decodeContract(symbol).strike),
      optionSymbol: symbol,
      contracts: quantity.toNumber(),
      multiplier: 100,
      entryPremium: avgCost,
    };
  const orderId = guestId();
  const order: GuestPortfolio["orders"][number] = {
    id: orderId,
    clientOrderId: ticket.clientOrderId ?? null,
    quoteSource: quote.source,
    portfolioId: p.id,
    assetClass: ticket.assetClass,
    symbol: ticket.symbol,
    side: ticket.side,
    orderType: ticket.orderType,
    quantity: new D(ticket.quantity),
    limitPrice: ticket.limitPrice != null ? new D(ticket.limitPrice) : null,
    status: "FILLED",
    optionContractSymbol: ticket.optionContractSymbol ?? null,
    optionRight: ticket.optionRight ?? null,
    optionStrike:
      ticket.optionStrike != null ? new D(ticket.optionStrike) : null,
    optionExpiration:
      ticket.assetClass === "OPTION" ? decodeContract(symbol).expiration : null,
    submittedAt: now,
    filledAt: now,
    fills: [
      {
        id: guestId(),
        orderId,
        positionId: position?.id ?? null,
        side: ticket.side,
        quantity: new D(ticket.quantity),
        price: new D(fillPrice).toDecimalPlaces(6),
        realizedPnL,
        executedAt: now,
      },
    ],
  };
  if (existing) p.positions = p.positions.filter((x) => x.id !== existing.id);
  if (position) p.positions.push(position);
  else if (existing)
    for (const order of p.orders)
      for (const fill of order.fills)
        if (fill.positionId === existing.id) fill.positionId = null;
  p.cashBalance = nextCash;
  p.updatedAt = now;
  p.orders.push(order);
  p.cashLedgerEntries.push({
    id: order.id,
    portfolioId: p.id,
    type: ticket.side,
    amount: new D(ticket.side === "BUY" ? -notional : notional),
    note: executionAuditNote(
      ticket.side,
      ticket.quantity,
      symbol,
      quote,
      closedSession,
    ),
    createdAt: now,
  });
  return executionResult(p, order, false);
}
export async function guestTarget(
  state: GuestWorkspace,
  id: string,
  body: unknown,
) {
  const input = targetScenarioSchema.parse(body),
    p = ownedPosition(state, id);
  const underlying = p.optionDetails?.underlying ?? p.symbol;
  let shares: number | null = null;
  if (input.targetMode === "MARKET_CAP" && !input.useManualShares)
    shares = await providers.fundamentals
      .getSharesOutstanding(underlying)
      .catch(() => null);
  if (
    input.targetMode === "MARKET_CAP" &&
    !(input.useManualShares
      ? input.sharesOutstandingManual
      : shares != null && Number.isFinite(shares) && shares >= 0.000001
        ? shares
        : null)
  )
    throw new GuestError(
      "Shares outstanding unavailable. Enable the manual override and enter a positive share count.",
    );
  const decimal = (n: number | undefined | null) =>
    n == null ? null : new D(n).toDecimalPlaces(6);
  p.targetScenario = {
    positionId: p.id,
    targetMode: input.targetMode,
    targetPrice: decimal(input.targetPrice),
    targetMarketCap: decimal(input.targetMarketCap),
    sharesOutstandingLive: decimal(shares),
    sharesOutstandingManual: decimal(input.sharesOutstandingManual),
    useManualShares: input.useManualShares ?? false,
    updatedAt: new Date(),
  };
  return { targetScenario: p.targetScenario };
}
export function guestFailure(error: unknown) {
  if (error instanceof z.ZodError)
    return Response.json(
      { error: "Invalid portfolio input", details: error.flatten() },
      { status: 400 },
    );
  if (error instanceof SyntaxError)
    return Response.json({ error: "Invalid JSON payload" }, { status: 400 });
  return Response.json(
    {
      error:
        error instanceof Error ? error.message : "Guest workspace unavailable",
    },
    { status: error instanceof GuestError ? error.status : 400 },
  );
}
