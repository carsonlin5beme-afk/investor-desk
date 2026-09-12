import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { decideFill, estimateOrderNotional } from "@/server/domain/fill-engine";
import { OrderTicket, MarketQuote } from "@/server/domain/types";
import { isQuoteStale } from "@/server/domain/staleness";
import { decodeContract } from "@/server/providers/demo";
import { assertOptionNotExpired } from "@/lib/option-expiration";
import { getLiveQuote } from "./quote-service";
import type { ClosedSessionBasis } from "@/lib/quote-status";
import { optionDeliverableUnverified } from "@/lib/quote-status";
import {
  assertClosedSessionCurrent,
  auditQuoteMetadata,
  closedSessionEligibility,
  executionAuditNote,
} from "./closed-session-simulation";
const D = Prisma.Decimal;
export function assertExecutionCurrent(
  ticket: OrderTicket,
  quote: MarketQuote,
  closedSession: ClosedSessionBasis | null,
) {
  assertClosedSessionCurrent(closedSession);
  if (ticket.assetClass === "OPTION") {
    if (optionDeliverableUnverified(quote.source))
      throw new Error(
        "Standard deliverable unverified. Tradier contract prices remain visible, but new simulated fills are unavailable with this source.",
      );
    const meta = decodeContract(ticket.optionContractSymbol!);
    assertOptionNotExpired(meta.expiration, meta.underlying);
  }
  if (
    !closedSession &&
    quote.source !== "demo" &&
    (/delayed|indicative/.test(quote.source) ||
      isQuoteStale(quote.asOf, env.QUOTE_STALE_SECONDS))
  )
    throw new Error(
      "Quote became stale before execution. Refresh and preview the order again.",
    );
}
export async function resolveTicket(ticket: OrderTicket, execute = false) {
  const symbol =
    ticket.assetClass === "OPTION"
      ? ticket.optionContractSymbol!
      : ticket.symbol;
  if (ticket.assetClass === "OPTION") {
    const meta = decodeContract(symbol);
    if (
      meta.underlying !== ticket.symbol ||
      meta.right !== ticket.optionRight ||
      meta.strike !== ticket.optionStrike ||
      meta.expiration.toISOString().slice(0, 10) !==
        ticket.optionExpiration?.toISOString().slice(0, 10)
    )
      throw new Error("Option contract does not match selected terms.");
    assertOptionNotExpired(meta.expiration, meta.underlying);
  }
  const quote = await getLiveQuote(symbol, ticket.assetClass, true);
  if (!quote)
    throw new Error(
      "No quote available. In sample mode choose a supported sample symbol; in live mode check provider credentials.",
    );
  if (
    quote.source !== "demo" &&
    (quote.source.includes("delayed") ||
      quote.source.includes("indicative") ||
      !Number.isFinite(quote.asOf.getTime()) ||
      quote.asOf.getTime() > Date.now() + 5000)
  )
    throw new Error(
      "Quote is stale or delayed. Last prices remain visible, but a fresh bid/ask is required to trade.",
    );
  let closedSession: ClosedSessionBasis | null = null;
  if (
    quote.source !== "demo" &&
    Date.now() - quote.asOf.getTime() > env.QUOTE_STALE_SECONDS * 1000
  ) {
    const eligibility = await closedSessionEligibility(quote, execute);
    if (!eligibility.basis)
      throw new Error(
        eligibility.reason ??
          "Quote is stale or delayed. Last prices remain visible, but a fresh bid/ask is required to trade.",
      );
    if (ticket.orderType !== "LIMIT")
      throw new Error(
        "Use a simulated limit order with the last available quote while the regular session is closed.",
      );
    closedSession = eligibility.basis;
  }
  if (execute && (closedSession || ticket.closedSessionPreview)) {
    const expected = ticket.closedSessionPreview;
    if (
      !expected ||
      !closedSession ||
      expected.kind !== closedSession.kind ||
      expected.quoteSource !== closedSession.quoteSource ||
      expected.quoteAsOf !== closedSession.quoteAsOf ||
      expected.quoteBid !== closedSession.quoteBid ||
      expected.quoteAsk !== closedSession.quoteAsk ||
      expected.sessionDate !== closedSession.sessionDate ||
      expected.nextOpen !== closedSession.nextOpen ||
      Date.parse(expected.validUntil) > Date.now() + 60000
    )
      throw new Error(
        "The quote or session basis changed. Preview the simulated limit order again.",
      );
    assertClosedSessionCurrent(expected);
    closedSession.validUntil = expected.validUntil;
  }
  assertExecutionCurrent(ticket, quote, closedSession);
  const decision = decideFill(ticket, quote);
  return { symbol, quote, decision, closedSession };
}
async function checkAccount(
  tx: Prisma.TransactionClient,
  ticket: OrderTicket,
  symbol: string,
  notional: number,
) {
  const portfolio = await tx.portfolio.findUnique({
    where: { id: ticket.portfolioId },
  });
  if (!portfolio) throw new Error("Portfolio not found.");
  const position = await tx.position.findUnique({
    where: {
      portfolioId_symbol_assetClass: {
        portfolioId: ticket.portfolioId,
        symbol,
        assetClass: ticket.assetClass,
      },
    },
    include: { optionDetails: true },
  });
  if (ticket.side === "BUY" && portfolio.cashBalance.lessThan(notional))
    throw new Error(
      "Insufficient cash balance. Reduce quantity or add simulated cash.",
    );
  if (
    ticket.side === "SELL" &&
    (!position || position.quantity.lessThan(ticket.quantity))
  )
    throw new Error(
      "Cannot sell more than the quantity owned. Short selling is disabled.",
    );
  // Permit only a full close of a sub-cent residual, with proceeds rounded to cents.
  if (
    notional < 0.01 &&
    !(ticket.side === "SELL" && position?.quantity.equals(ticket.quantity))
  )
    throw new Error(
      "Minimum order value is $0.01, except when closing an entire residual position.",
    );
  return { portfolio, position };
}
export const previewOrder = async (ticket: OrderTicket) => {
  const { symbol, quote, decision, closedSession } =
    await resolveTicket(ticket);
  if (!decision.fillable || decision.fillPrice == null)
    return { ...decision, quote, closedSession };
  const estimatedNotional = estimateOrderNotional(ticket, decision.fillPrice);
  const { portfolio, position } = await checkAccount(
    prisma,
    ticket,
    symbol,
    estimatedNotional,
  );
  return {
    fillable: true,
    estimatedFillPrice: decision.fillPrice,
    estimatedNotional,
    cashBefore: portfolio.cashBalance.toNumber(),
    cashAfter: portfolio.cashBalance
      .plus(ticket.side === "BUY" ? -estimatedNotional : estimatedNotional)
      .toNumber(),
    ownedQuantity: position?.quantity.toNumber() ?? 0,
    quote,
    closedSession,
    fees: 0,
  };
};
async function replay(tx: Prisma.TransactionClient, ticket: OrderTicket) {
  if (!ticket.clientOrderId) return null;
  const order = await tx.order.findUnique({
    where: { clientOrderId: ticket.clientOrderId },
    include: { fills: true },
  });
  if (!order) return null;
  if (
    order.portfolioId !== ticket.portfolioId ||
    order.symbol !== ticket.symbol ||
    order.side !== ticket.side ||
    order.assetClass !== ticket.assetClass ||
    !order.quantity.equals(ticket.quantity) ||
    order.orderType !== ticket.orderType ||
    order.optionContractSymbol !== (ticket.optionContractSymbol ?? null) ||
    (order.limitPrice?.toNumber() ?? null) !== (ticket.limitPrice ?? null)
  )
    throw new Error(
      "This submission ID was already used for a different order.",
    );
  const fill = order.fills[0];
  if (!fill) throw new Error("Previous submission is incomplete.");
  const portfolio = await tx.portfolio.findUniqueOrThrow({
    where: { id: ticket.portfolioId },
  });
  const position = fill.positionId
    ? await tx.position.findUnique({ where: { id: fill.positionId } })
    : null;
  const audit = await tx.cashLedgerEntry.findFirst({
    where: { id: order.id, portfolioId: order.portfolioId, type: order.side },
    select: { note: true },
  });
  return {
    order,
    fill,
    position,
    portfolioCashBalance: portfolio.cashBalance.toNumber(),
    fillPrice: fill.price.toNumber(),
    notional: estimateOrderNotional(ticket, fill.price.toNumber()),
    replayed: true,
    quoteSource: order.quoteSource,
    ...auditQuoteMetadata(audit?.note),
  };
}
export const executeOrder = async (ticket: OrderTicket) => {
  const previous = await replay(prisma, ticket);
  if (previous) return previous;
  const { symbol, quote, decision, closedSession } = await resolveTicket(
    ticket,
    true,
  );
  if (!decision.fillable || decision.fillPrice == null)
    throw new Error(decision.reason ?? "Order not fillable.");
  const fillPrice = decision.fillPrice;
  const notional = estimateOrderNotional(ticket, fillPrice);
  return prisma.$transaction(
    async (tx) => {
      // Serialize all cash and position mutations per portfolio, including withdrawals.
      await tx.$queryRaw`SELECT id FROM "Portfolio" WHERE id = ${ticket.portfolioId} FOR UPDATE`;
      const duplicate = await replay(tx, ticket);
      if (duplicate) return duplicate;
      assertExecutionCurrent(ticket, quote, closedSession);
      const { portfolio, position: existing } = await checkAccount(
        tx,
        ticket,
        symbol,
        notional,
      );
      const nextCash = portfolio.cashBalance.plus(
        ticket.side === "BUY" ? -notional : notional,
      );
      assertExecutionCurrent(ticket, quote, closedSession);
      await tx.portfolio.update({
        where: { id: portfolio.id },
        data: { cashBalance: nextCash },
      });
      const order = await tx.order.create({
        data: {
          clientOrderId: ticket.clientOrderId,
          quoteSource: quote.source,
          portfolioId: portfolio.id,
          assetClass: ticket.assetClass,
          symbol: ticket.symbol,
          orderType: ticket.orderType,
          side: ticket.side,
          quantity: ticket.quantity,
          limitPrice: ticket.limitPrice,
          status: "FILLED",
          optionContractSymbol: ticket.optionContractSymbol,
          optionRight: ticket.optionRight,
          optionStrike: ticket.optionStrike,
          optionExpiration:
            ticket.assetClass === "OPTION"
              ? decodeContract(symbol).expiration
              : undefined,
          filledAt: new Date(),
        },
      });
      await tx.cashLedgerEntry.create({
        data: {
          // Durable receipt association without changing the database schema.
          id: order.id,
          portfolioId: portfolio.id,
          type: ticket.side,
          amount: ticket.side === "BUY" ? -notional : notional,
          note: executionAuditNote(
            ticket.side,
            ticket.quantity,
            symbol,
            quote,
            closedSession,
          ),
        },
      });
      const quantity = (existing?.quantity ?? new D(0)).plus(
        ticket.side === "BUY" ? ticket.quantity : -ticket.quantity,
      );
      const realizedPnL =
        ticket.side === "SELL" && existing
          ? new D(fillPrice)
              .minus(existing.avgCost)
              .times(ticket.quantity)
              .times(ticket.assetClass === "OPTION" ? 100 : 1)
          : new D(0);
      let position = null;
      if (quantity.isZero() && existing) {
        await tx.position.delete({ where: { id: existing.id } });
      } else {
        const avgCost =
          ticket.side === "BUY"
            ? (existing?.quantity.times(existing.avgCost) ?? new D(0))
                .plus(new D(ticket.quantity).times(fillPrice))
                .dividedBy(quantity)
            : existing!.avgCost;
        if (existing)
          position = await tx.position.update({
            where: { id: existing.id },
            data: { quantity, avgCost },
          });
        else
          position = await tx.position.create({
            data: {
              portfolioId: portfolio.id,
              assetClass: ticket.assetClass,
              symbol,
              quantity,
              avgCost,
            },
          });
        if (ticket.assetClass === "OPTION") {
          const meta = decodeContract(symbol);
          await tx.optionPositionDetails.upsert({
            where: { positionId: position.id },
            create: {
              positionId: position.id,
              ...meta,
              optionSymbol: symbol,
              contracts: quantity.toNumber(),
              multiplier: 100,
              entryPremium: avgCost,
            },
            update: { contracts: quantity.toNumber(), entryPremium: avgCost },
          });
        }
      }
      const fill = await tx.fill.create({
        data: {
          orderId: order.id,
          positionId: position?.id,
          side: ticket.side,
          quantity: ticket.quantity,
          price: fillPrice,
          realizedPnL,
        },
      });
      assertExecutionCurrent(ticket, quote, closedSession);
      return {
        order,
        fill,
        position,
        portfolioCashBalance: nextCash.toNumber(),
        fillPrice,
        notional,
        replayed: false,
        quoteSource: quote.source,
        ...auditQuoteMetadata(
          executionAuditNote(
            ticket.side,
            ticket.quantity,
            symbol,
            quote,
            closedSession,
          ),
        ),
      };
    },
    { maxWait: 15000, timeout: 15000 },
  );
};
