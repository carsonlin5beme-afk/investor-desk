import { OrderType, Prisma, Side } from "@prisma/client";
import { FillDecision, MarketQuote, OrderTicket } from "./types";
export const decideFill = (
  ticket: OrderTicket,
  quote: MarketQuote,
): FillDecision => {
  if (!Number.isFinite(ticket.quantity) || ticket.quantity <= 0)
    return { fillable: false, reason: "Quantity must be positive." };
  if (ticket.assetClass === "OPTION" && !Number.isInteger(ticket.quantity))
    return { fillable: false, reason: "Options require whole contracts." };
  const price = ticket.side === Side.BUY ? quote.ask : quote.bid;
  if (price == null || !Number.isFinite(price) || price <= 0)
    return {
      fillable: false,
      reason: `No executable ${ticket.side === Side.BUY ? "ask" : "bid"} available.`,
    };
  if (quote.bid != null && quote.ask != null && quote.bid > quote.ask)
    return {
      fillable: false,
      reason: "Crossed or invalid market quote. Try again.",
    };
  if (ticket.orderType === OrderType.LIMIT) {
    if (
      !ticket.limitPrice ||
      !Number.isFinite(ticket.limitPrice) ||
      ticket.limitPrice <= 0
    )
      return { fillable: false, reason: "A positive limit price is required." };
    if (
      ticket.side === Side.BUY
        ? price > ticket.limitPrice
        : price < ticket.limitPrice
    )
      return {
        fillable: false,
        reason:
          "Limit not crossed. This simulator uses immediate-or-cancel limits; no resting order is placed.",
      };
  }
  return { fillable: true, fillPrice: price };
};
export const estimateOrderNotional = (
  ticket: Pick<OrderTicket, "quantity" | "assetClass">,
  price: number,
) =>
  // Match six-decimal fill storage and round cash once with decimal, not binary, arithmetic.
  new Prisma.Decimal(price)
    .toDecimalPlaces(6)
    .times(ticket.quantity)
    .times(ticket.assetClass === "OPTION" ? 100 : 1)
    .toDecimalPlaces(2)
    .toNumber();
export const hasSufficientCashForBuy = (cash: number, notional: number) =>
  cash >= notional;
