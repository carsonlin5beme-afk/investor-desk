import { optionExpirationDate } from "./option-expiration";

export const MANUAL_OPTION_SOURCE = "manual";
export const MANUAL_OPTION_PREFIX = "MANUAL:";
export const MAX_MANUAL_PREMIUM = 1_000_000;
export const MAX_MANUAL_NOTIONAL = 1_000_000_000_000;

// Reserve the entire namespace, including malformed/future versions, before any
// provider/cache lookup. Manual instruments can never become provider quotes.
export const isManualOptionSymbol = (symbol: string) =>
  symbol.trim().toUpperCase().startsWith(MANUAL_OPTION_PREFIX);

export type ManualOptionTerms = {
  underlying: string;
  right: "CALL" | "PUT";
  strike: number;
  expiration: string | Date;
};
export function manualOptionSymbol(terms: ManualOptionTerms) {
  const { underlying, right, strike } = terms;
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(underlying))
    throw new Error("Enter a valid underlying ticker.");
  if (right !== "CALL" && right !== "PUT")
    throw new Error("Choose a call or put.");
  if (
    !Number.isFinite(strike) ||
    strike < 0.001 ||
    strike > 99999.999 ||
    Math.abs(strike * 1000 - Math.round(strike * 1000)) > 1e-7
  )
    throw new Error(
      "Strike must be positive, at most $99,999.999, with up to three decimals.",
    );
  const date = optionExpirationDate(terms.expiration);
  return `MANUAL:V1:${underlying}:${date}:${right === "CALL" ? "C" : "P"}:${Math.round(strike * 1000)}:100`;
}
export function parseManualOptionSymbol(
  symbol: string,
): ManualOptionTerms & { expiration: Date } {
  const match =
    /^MANUAL:V1:([A-Z][A-Z0-9.\-]{0,9}):(\d{4}-\d{2}-\d{2}):([CP]):([1-9]\d{0,7}):100$/.exec(
      symbol,
    );
  if (!match) throw new Error("Invalid manual option identity.");
  const terms = {
    underlying: match[1],
    expiration: new Date(`${optionExpirationDate(match[2])}T00:00:00.000Z`),
    right: match[3] === "C" ? ("CALL" as const) : ("PUT" as const),
    strike: Number(match[4]) / 1000,
  };
  if (manualOptionSymbol(terms) !== symbol)
    throw new Error("Invalid manual option identity.");
  return terms;
}

export function validateManualOptionTicket(ticket: {
  assetClass: string;
  symbol: string;
  optionPricing?: "PROVIDER" | "MANUAL";
  manualPremium?: number;
  quantity: number;
  orderType: string;
  limitPrice?: number;
  optionContractSymbol?: string;
  optionRight?: "CALL" | "PUT";
  optionStrike?: number;
  optionExpiration?: string | Date;
  closedSessionPreview?: unknown;
}) {
  if (ticket.optionPricing !== "MANUAL") {
    if (
      isManualOptionSymbol(ticket.optionContractSymbol ?? "") ||
      ticket.manualPremium !== undefined
    )
      throw new Error("Manual options require manual entry pricing.");
    return null;
  }
  if (
    ticket.assetClass !== "OPTION" ||
    ticket.orderType !== "MARKET" ||
    ticket.limitPrice !== undefined ||
    ticket.closedSessionPreview !== undefined
  )
    throw new Error(
      "Manual entry records an option at your entered premium; quote and limit pricing do not apply.",
    );
  if (
    !Number.isInteger(ticket.quantity) ||
    ticket.quantity <= 0 ||
    ticket.quantity > 1e9
  )
    throw new Error(
      "Options require a positive whole contract count, at most one billion.",
    );
  const premium = ticket.manualPremium;
  if (
    premium == null ||
    !Number.isFinite(premium) ||
    premium < 0.000001 ||
    premium > MAX_MANUAL_PREMIUM ||
    Number(premium.toFixed(6)) !== premium
  )
    throw new Error(
      "Enter a positive premium per share, up to $1,000,000 and six decimals.",
    );
  if (premium * ticket.quantity * 100 > MAX_MANUAL_NOTIONAL)
    throw new Error("Manual option order value cannot exceed $1 trillion.");
  if (
    !ticket.optionRight ||
    ticket.optionStrike == null ||
    !ticket.optionExpiration
  )
    throw new Error(
      "Enter the option right, strike and actual expiration date.",
    );
  const symbol = manualOptionSymbol({
    underlying: ticket.symbol,
    right: ticket.optionRight,
    strike: ticket.optionStrike,
    expiration: ticket.optionExpiration,
  });
  if (
    ticket.optionContractSymbol !== undefined &&
    ticket.optionContractSymbol !== symbol
  )
    throw new Error("Manual option identity does not match the entered terms.");
  return { symbol, ...parseManualOptionSymbol(symbol), premium };
}
