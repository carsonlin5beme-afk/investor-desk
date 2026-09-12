import { easternDate, sessionTime } from "./market-time";

// Published NYSE calendar and Nasdaq eligible late-close ETF/ETN list, checked
// 2026-09-12. No extended-hours, index, exercise or settlement model is implied.
// https://www.nyse.com/trade/hours-calendars
// https://www.nasdaqtrader.com/Trader.aspx?id=optionshours
export const optionExpiryPolicy = "us-equity-options-2026-09-12";
const holidays = new Set([
  "2026-01-01",
  "2026-01-19",
  "2026-02-16",
  "2026-04-03",
  "2026-05-25",
  "2026-06-19",
  "2026-07-03",
  "2026-09-07",
  "2026-11-26",
  "2026-12-25",
  "2027-01-01",
  "2027-01-18",
  "2027-02-15",
  "2027-03-26",
  "2027-05-31",
  "2027-06-18",
  "2027-07-05",
  "2027-09-06",
  "2027-11-25",
  "2027-12-24",
  "2028-01-17",
  "2028-02-21",
  "2028-04-14",
  "2028-05-29",
  "2028-06-19",
  "2028-07-04",
  "2028-09-04",
  "2028-11-23",
  "2028-12-25",
]);
const earlyCloses = new Set([
  "2026-11-27",
  "2026-12-24",
  "2027-11-26",
  "2028-07-03",
  "2028-11-24",
]);
const lateCloses = new Set(
  "DBA DBB DBC DBO DIA DRAM EEM EFA EWY EWZ FXI GLD HYG IBIT IEF IVV IWM IWN IWO IYR KBE KRE KWEB LQD MDY MOO OEF QQQ RSP SLV SMH SOXL SOXX SPY SVIX SVXY TIP TLT UNG UUP UVIX UVXY VIXM VIXY VOO VXX VXZ XHB XLB XLC XLE XLF XLI XLK XLP XLRE XLU XLV XLY XME XOP XRT".split(
    " ",
  ),
);

/** The provider/OCC calendar date is identity; an old stored UTC hour is not. */
export function optionExpirationDate(value: string | Date): string {
  const date =
    value instanceof Date
      ? value.toISOString().slice(0, 10)
      : value.slice(0, 10);
  const parsed = new Date(`${date}T12:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date ||
    (typeof value === "string" &&
      value.length > 10 &&
      !Number.isFinite(Date.parse(value)))
  )
    throw new Error("Invalid option expiration date.");
  return date;
}

export function resolveOptionExpiry(
  expiration: string | Date,
  underlying: string,
) {
  const expirationDate = optionExpirationDate(expiration);
  const weekday = new Date(`${expirationDate}T12:00:00Z`).getUTCDay();
  const covered =
    expirationDate >= "2026-01-01" && expirationDate <= "2028-12-31";
  const closed = weekday === 0 || weekday === 6 || holidays.has(expirationDate);
  const assumed = !covered || closed;
  const hour = earlyCloses.has(expirationDate) ? "13" : "16";
  const symbol = underlying.toUpperCase();
  // Nasdaq alert OTA 2026-10: VOO's later close began February 25, 2026.
  const late =
    lateCloses.has(symbol) &&
    !(symbol === "VOO" && expirationDate < "2026-02-25");
  const minute = late ? "15" : "00";
  const modelExpirationAt = new Date(
    sessionTime(expirationDate, `${hour}:${minute}`),
  );
  return {
    expirationDate,
    modelExpirationAt,
    tradingCutoffAt: assumed ? null : modelExpirationAt,
    scheduleStatus: closed
      ? ("CLOSED" as const)
      : covered
        ? ("KNOWN" as const)
        : ("ASSUMED" as const),
    policyVersion: optionExpiryPolicy,
  };
}

export function assertOptionNotExpired(
  expiration: string | Date,
  underlying: string,
  now = Date.now(),
) {
  const expiry = resolveOptionExpiry(expiration, underlying);
  if (expiry.scheduleStatus === "CLOSED")
    throw new Error(
      "Option expiration falls on a non-trading date. Refresh the exact contract.",
    );
  if (optionHasExpired(expiry, now))
    throw new Error("Expired contracts cannot be traded.");
  // A future LEAPS date need not have a published calendar yet. On expiry day,
  // new fills require a verified cutoff; nominal model times cannot authorize it.
  if (!expiry.tradingCutoffAt && easternDate(now) >= expiry.expirationDate)
    throw new Error(
      "The expiration-day trading cutoff is unavailable. Update the market calendar before trading this contract.",
    );
  return expiry;
}

/** Unknown intraday cutoffs are model assumptions, never confirmed expiry. */
export function optionHasExpired(
  expiry: ReturnType<typeof resolveOptionExpiry>,
  now = Date.now(),
) {
  return expiry.tradingCutoffAt
    ? expiry.tradingCutoffAt.getTime() <= now
    : easternDate(now) > expiry.expirationDate;
}
